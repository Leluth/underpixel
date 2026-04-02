import {
  CaptureConfig,
  CaptureSession,
  DEFAULT_CAPTURE_CONFIG,
  TOOL_NAMES,
} from 'underpixel-shared';
import { toolRegistry } from './registry';
import { resolveTabId, getActiveTabId } from './tab-utils';
import { startCapture, stopCapture } from '../network/capture';
import { correlationEngine } from '../correlation/engine';
import { db, getLatestSession } from '../storage/db';
import { flushPendingEvents, clearSessionBuffer } from '../recording/event-batcher';

// ---- capture_start ----

toolRegistry.register(TOOL_NAMES.CAPTURE_START, async (args) => {
  const filter = (args.filter as Partial<CaptureConfig>) || {};
  const screenshotsEnabled = (args.screenshotsEnabled as boolean) ?? true;

  // Resolve target tab
  let tabId = resolveTabId(args.tabId);
  if (!tabId) tabId = await getActiveTabId();

  const tab = await chrome.tabs.get(tabId);

  // chrome:// and edge:// URLs can't be captured
  if (tab.url && /^(chrome|edge|about|devtools):/.test(tab.url)) {
    throw new Error(`Cannot capture on ${tab.url} — navigate to a regular webpage first`);
  }

  // Build config
  const config: CaptureConfig = {
    ...DEFAULT_CAPTURE_CONFIG,
    ...filter,
    screenshotsEnabled,
  } as CaptureConfig;

  // Create session
  const session: CaptureSession = {
    id: crypto.randomUUID(),
    startTime: Date.now(),
    initialUrl: tab.url || '',
    initialTitle: tab.title || '',
    tabId,
    status: 'active',
    config,
    stats: {
      networkRequestCount: 0,
      rrwebEventCount: 0,
      screenshotCount: 0,
      correlationBundleCount: 0,
    },
  };

  const database = await db();
  await database.put('sessions', session);

  // Start network capture
  await startCapture(tabId, session.id, config);

  // Persist capture state for service worker restart recovery
  await chrome.storage.local.set({
    captureActive: true,
    activeSessionId: session.id,
    activeTabId: tabId,
  });

  // Start rrweb recording in the tab
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: 'underpixel-command',
      action: 'start-recording',
      config: {
        sampling: config.rrwebSampling,
        maskInputs: config.maskInputs,
        maskTextSelector: config.maskTextSelector,
      },
    });
  } catch {
    // Content script may not be injected yet — acceptable for network-only capture
  }

  return {
    summary: `Capture started on "${tab.title}" (tab ${tabId})`,
    sessionId: session.id,
    tabId,
    url: tab.url,
    config: {
      includeStatic: config.includeStatic,
      screenshotsEnabled: config.screenshotsEnabled,
      correlationWindow: config.correlationWindow,
    },
  };
});

// ---- capture_stop ----

toolRegistry.register(TOOL_NAMES.CAPTURE_STOP, async (args) => {
  let sessionId = args.sessionId as string | undefined;
  let tabId: number | undefined;

  const database = await db();

  if (sessionId) {
    const session = await database.get('sessions', sessionId);
    if (session) tabId = session.tabId;
  } else {
    // Find active session
    const storage = await chrome.storage.local.get(['activeSessionId', 'activeTabId']);
    sessionId = storage.activeSessionId as string | undefined;
    tabId = storage.activeTabId as number | undefined;
  }

  if (!sessionId) throw new Error('No active capture session found');

  // Stop network capture
  if (tabId) {
    await stopCapture(tabId);

    // Stop rrweb recording
    try {
      await chrome.tabs.sendMessage(tabId, {
        type: 'underpixel-command',
        action: 'stop-recording',
      });
    } catch {
      // Content script may be gone
    }
  }

  // Flush any buffered rrweb events before closing the session
  await flushPendingEvents();

  // Update session (reuse db handle from above)
  const session = await database.get('sessions', sessionId);
  if (session) {
    session.status = 'stopped';
    session.endTime = Date.now();
    await database.put('sessions', session);
  }

  // Clear correlation engine state and event buffer
  correlationEngine.clearSession(sessionId);
  clearSessionBuffer(sessionId);

  // Clear persisted capture state
  await chrome.storage.local.set({
    captureActive: false,
    activeSessionId: null,
    activeTabId: null,
  });

  return {
    summary:
      `Capture stopped. ${session?.stats.networkRequestCount || 0} API calls, ` +
      `${session?.stats.correlationBundleCount || 0} correlations, ` +
      `${session?.stats.screenshotCount || 0} screenshots`,
    sessionId,
    stats: session?.stats,
    duration: session ? session.endTime! - session.startTime : 0,
  };
});

// ---- api_calls ----

toolRegistry.register(TOOL_NAMES.API_CALLS, async (args) => {
  let sessionId = args.sessionId as string | undefined;
  if (!sessionId) {
    const session = await getLatestSession();
    if (!session) throw new Error('No capture sessions found');
    sessionId = session.id;
  }

  const database = await db();
  let requests = await database.getAllFromIndex('networkRequests', 'by-session', sessionId);

  // Apply filters
  const urlPattern = args.urlPattern as string | undefined;
  const method = args.method as string | undefined;
  const statusCode = args.statusCode as number | undefined;
  const includeBody = (args.includeBody as boolean) ?? false;
  const limit = (args.limit as number) || 50;

  if (urlPattern) {
    requests = requests.filter((r) => r.url.includes(urlPattern));
  }
  if (method) {
    requests = requests.filter((r) => r.method === method.toUpperCase());
  }
  if (statusCode) {
    requests = requests.filter((r) => r.statusCode === statusCode);
  }

  // Sort by time
  requests.sort((a, b) => a.startTime - b.startTime);

  // Limit
  requests = requests.slice(0, limit);

  // Format response
  const calls = await Promise.all(
    requests.map(async (r) => {
      const call: Record<string, unknown> = {
        id: r.requestId,
        method: r.method,
        url: r.url,
        status: r.statusCode,
        duration: r.duration,
        timestamp: r.startTime,
        type: r.type,
        responseSize: r.encodedDataLength,
      };

      if (includeBody) {
        call.requestHeaders = r.requestHeaders;
        call.requestBody = r.requestBody;
        call.responseHeaders = r.responseHeaders;

        if (r.responseBody) {
          call.responseBody = r.responseBody;
        } else if (r.responseBodyRef) {
          // Fetch from separate store
          const bodyRecord = await database.get('responseBodies', r.responseBodyRef);
          call.responseBody = bodyRecord?.body;
        }
      }

      return call;
    }),
  );

  const successCount = requests.filter((r) => r.statusCode && r.statusCode < 400).length;
  const errorCount = requests.filter((r) => r.statusCode && r.statusCode >= 400).length;

  return {
    summary: `${requests.length} API calls (${successCount} success, ${errorCount} errors)`,
    sessionId,
    calls,
  };
});
