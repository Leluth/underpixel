import type { CorrelationBundle, StoredRrwebEvent } from 'underpixel-shared';
import { db } from '../storage/db';

interface RecentMutation {
  timestamp: number;
  adds: number;
  removes: number;
  texts: number;
  attributes: number;
}

class CorrelationEngine {
  /** sessionId -> recent DOM mutations */
  private recentMutations = new Map<string, RecentMutation[]>();
  /** Pending correlation timers */
  private pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();

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
  onApiResponse(sessionId: string, requestId: string, timestamp: number): void {
    // Wait for the correlation window to close before building bundle
    // (DOM mutations from this API response may still be arriving)
    this.getCorrelationWindow(sessionId).then((window) => {
      const key = `${sessionId}:${requestId}`;
      if (this.pendingTimers.has(key)) return; // Already pending

      this.pendingTimers.set(
        key,
        setTimeout(async () => {
          this.pendingTimers.delete(key);
          await this.buildBundle(sessionId, requestId, timestamp, window);
        }, window),
      );
    });
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

    // Find DOM mutations within [apiTime, apiTime + window]
    const correlated = mutations.filter(
      (m) => m.timestamp >= apiTime && m.timestamp <= apiTime + window,
    );

    if (correlated.length === 0) return; // API didn't cause DOM changes

    const database = await db();
    const request = await database.get('networkRequests', requestId);
    if (!request) return;

    let shortUrl: string;
    try {
      shortUrl = new URL(request.url).pathname;
    } catch {
      shortUrl = request.url;
    }

    const bundle: CorrelationBundle = {
      id: crypto.randomUUID(),
      sessionId,
      timestamp: apiTime,
      trigger: `${request.method} ${shortUrl}`,
      apiCalls: [requestId],
      rrwebEventIds: [],
      domMutationSummary: {
        addedNodes: correlated.reduce((s, m) => s + m.adds, 0),
        removedNodes: correlated.reduce((s, m) => s + m.removes, 0),
        textChanges: correlated.reduce((s, m) => s + m.texts, 0),
        attributeChanges: correlated.reduce((s, m) => s + m.attributes, 0),
      },
      correlation:
        `${request.method} ${shortUrl} -> ` +
        `${correlated.reduce((s, m) => s + m.adds, 0)} nodes added, ` +
        `${correlated.reduce((s, m) => s + m.texts, 0)} text changes`,
    };

    await database.put('correlationBundles', bundle);

    // Update session stats
    const session = await database.get('sessions', sessionId);
    if (session) {
      session.stats.correlationBundleCount++;
      await database.put('sessions', session);
    }
  }

  private pruneOldMutations(sessionId: string, cutoff: number): void {
    const mutations = this.recentMutations.get(sessionId);
    if (!mutations) return;
    const pruned = mutations.filter((m) => m.timestamp >= cutoff);
    this.recentMutations.set(sessionId, pruned);
  }

  /** Clean up when a session ends */
  clearSession(sessionId: string): void {
    this.recentMutations.delete(sessionId);
    for (const [key, timer] of this.pendingTimers) {
      if (key.startsWith(sessionId)) {
        clearTimeout(timer);
        this.pendingTimers.delete(key);
      }
    }
  }
}

export const correlationEngine = new CorrelationEngine();
