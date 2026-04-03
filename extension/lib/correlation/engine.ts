import type { CorrelationBundle, StoredRrwebEvent } from 'underpixel-shared';
import { db } from '../storage/db';

interface RecentMutation {
  timestamp: number;
  adds: number;
  removes: number;
  texts: number;
  attributes: number;
}

/** Minimal info needed from the network request to build a bundle trigger string */
export interface ApiResponseInfo {
  method: string;
  url: string;
}

/**
 * Backward buffer (ms) added to the correlation window to account for CDP
 * event delivery latency.  Network.loadingFinished arrives in the background
 * slightly *after* the page's JS callback fires and mutates the DOM, so
 * mutations can have timestamps a few ms before `apiTime`.
 */
const PRE_CORRELATION_BUFFER = 100;

class CorrelationEngine {
  /** sessionId -> recent DOM mutations */
  private recentMutations = new Map<string, RecentMutation[]>();
  /** Pending correlation timers */
  private pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Cached correlation window per session (config never changes mid-capture) */
  private windowCache = new Map<string, number>();
  /** In-memory bundle count per session (flushed on session end) */
  private bundleCounts = new Map<string, number>();
  /** Pending request info for buildBundle (avoids IDB re-read) */
  private pendingRequestInfo = new Map<string, ApiResponseInfo>();

  /** Called when content script sends rrweb IncrementalSnapshot events */
  onDomMutation(sessionId: string, event: StoredRrwebEvent): void {
    // Only track DOM mutations (IncrementalSource.Mutation = 0)
    if (event.type !== 3) return; // EventType.IncrementalSnapshot = 3
    const data = event.data as Record<string, unknown>;
    if (data?.source !== 0) return; // IncrementalSource.Mutation = 0

    if (!this.recentMutations.has(sessionId)) {
      this.recentMutations.set(sessionId, []);
    }

    this.recentMutations.get(sessionId)!.push({
      timestamp: event.timestamp,
      adds: Array.isArray(data.adds) ? data.adds.length : 0,
      removes: Array.isArray(data.removes) ? data.removes.length : 0,
      texts: Array.isArray(data.texts) ? data.texts.length : 0,
      attributes: Array.isArray(data.attributes) ? data.attributes.length : 0,
    });

    // Prune mutations older than 5s
    this.pruneOldMutations(sessionId, event.timestamp - 5000);
  }

  /** Called when a network response completes */
  onApiResponse(
    sessionId: string,
    requestId: string,
    timestamp: number,
    info: ApiResponseInfo,
  ): void {
    // Stash request info so buildBundle doesn't need to re-read from IDB
    this.pendingRequestInfo.set(requestId, info);

    // Wait for the correlation window to close before building bundle
    // (DOM mutations from this API response may still be arriving)
    const cached = this.windowCache.get(sessionId);
    if (cached !== undefined) {
      this.scheduleBundle(sessionId, requestId, timestamp, cached);
    } else {
      this.getCorrelationWindow(sessionId).then((window) => {
        this.windowCache.set(sessionId, window);
        this.scheduleBundle(sessionId, requestId, timestamp, window);
      });
    }
  }

  /** Get the accumulated bundle count for a session */
  getBundleCount(sessionId: string): number {
    return this.bundleCounts.get(sessionId) || 0;
  }

  /** Clean up when a session ends */
  clearSession(sessionId: string): void {
    this.recentMutations.delete(sessionId);
    this.windowCache.delete(sessionId);
    this.bundleCounts.delete(sessionId);
    for (const [key, timer] of this.pendingTimers) {
      if (key.startsWith(sessionId)) {
        clearTimeout(timer);
        this.pendingTimers.delete(key);
        // Clean up stashed request info (key format: "sessionId:requestId")
        const requestId = key.slice(sessionId.length + 1);
        this.pendingRequestInfo.delete(requestId);
      }
    }
  }

  private scheduleBundle(
    sessionId: string,
    requestId: string,
    timestamp: number,
    window: number,
  ): void {
    const key = `${sessionId}:${requestId}`;
    if (this.pendingTimers.has(key)) return; // Already pending

    this.pendingTimers.set(
      key,
      setTimeout(async () => {
        this.pendingTimers.delete(key);
        await this.buildBundle(sessionId, requestId, timestamp, window);
      }, window),
    );
  }

  private async getCorrelationWindow(sessionId: string): Promise<number> {
    const database = await db();
    const session = await database.get('sessions', sessionId);
    return session?.config?.correlationWindow || 500;
  }

  private async buildBundle(
    sessionId: string,
    requestId: string,
    apiTime: number,
    window: number,
  ): Promise<void> {
    const mutations = this.recentMutations.get(sessionId) || [];

    // Find DOM mutations within [apiTime - buffer, apiTime + window].
    // The backward buffer accounts for CDP event delivery latency: the
    // page's JS callback can fire and mutate the DOM before the background
    // receives Network.loadingFinished, so mutation timestamps may be
    // slightly earlier than apiTime.
    const correlated = mutations.filter(
      (m) => m.timestamp >= apiTime - PRE_CORRELATION_BUFFER && m.timestamp <= apiTime + window,
    );

    // Consume stashed request info regardless of whether we build a bundle
    const info = this.pendingRequestInfo.get(requestId);
    this.pendingRequestInfo.delete(requestId);

    if (correlated.length === 0) return; // API didn't cause DOM changes

    // Use stashed info (from onApiResponse) to avoid an IDB read
    const method = info?.method || 'UNKNOWN';
    const url = info?.url || requestId;

    let shortUrl: string;
    try {
      shortUrl = new URL(url).pathname;
    } catch {
      shortUrl = url;
    }

    const bundle: CorrelationBundle = {
      id: crypto.randomUUID(),
      sessionId,
      timestamp: apiTime,
      trigger: `${method} ${shortUrl}`,
      apiCalls: [requestId],
      rrwebEventIds: [],
      domMutationSummary: {
        addedNodes: correlated.reduce((s, m) => s + m.adds, 0),
        removedNodes: correlated.reduce((s, m) => s + m.removes, 0),
        textChanges: correlated.reduce((s, m) => s + m.texts, 0),
        attributeChanges: correlated.reduce((s, m) => s + m.attributes, 0),
      },
      correlation:
        `${method} ${shortUrl} -> ` +
        `${correlated.reduce((s, m) => s + m.adds, 0)} nodes added, ` +
        `${correlated.reduce((s, m) => s + m.texts, 0)} text changes`,
    };

    const database = await db();
    await database.put('correlationBundles', bundle);

    // Track bundle count in memory (flushed to IDB on session stop)
    this.bundleCounts.set(sessionId, (this.bundleCounts.get(sessionId) || 0) + 1);
  }

  private pruneOldMutations(sessionId: string, cutoff: number): void {
    const mutations = this.recentMutations.get(sessionId);
    if (!mutations) return;
    const pruned = mutations.filter((m) => m.timestamp >= cutoff);
    this.recentMutations.set(sessionId, pruned);
  }
}

export const correlationEngine = new CorrelationEngine();
