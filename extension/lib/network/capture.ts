import {
  NetworkRequest,
  CaptureConfig,
  DEFAULT_CAPTURE_CONFIG,
  MAX_RESPONSE_BODY_SIZE,
  INLINE_BODY_THRESHOLD,
  MAX_REQUESTS_PER_SESSION,
} from 'underpixel-shared';
import { cdpSession } from './cdp-session';
import { db } from '../storage/db';

const CDP_OWNER = 'underpixel-network';

/** Resource types treated as API calls (Document included for page-level fetches like HTML APIs) */
const API_RESOURCE_TYPES = ['XHR', 'Fetch', 'Document'];

/** Active captures: tabId -> sessionId */
const activeSessions = new Map<number, string>();
/** In-flight requests: CDP requestId -> partial NetworkRequest */
const pendingRequests = new Map<string, NetworkRequest>();
/** Request count per session */
const requestCounts = new Map<string, number>();

// Register CDP event listener once
chrome.debugger.onEvent.addListener(handleDebuggerEvent);
chrome.debugger.onDetach.addListener(handleDebuggerDetach);

/** Start network capture on a tab */
export async function startCapture(
  tabId: number,
  sessionId: string,
  config: CaptureConfig,
): Promise<void> {
  if (activeSessions.has(tabId)) {
    await stopCapture(tabId);
  }

  await cdpSession.attach(tabId, CDP_OWNER);

  try {
    await cdpSession.sendCommand(tabId, 'Network.enable', {
      maxPostDataSize: 65536,
    });
  } catch (err) {
    await cdpSession.detach(tabId, CDP_OWNER).catch(() => {});
    throw err;
  }

  activeSessions.set(tabId, sessionId);
  requestCounts.set(sessionId, 0);
  console.log(`[UnderPixel] Network capture started on tab ${tabId}`);
}

/** Stop network capture on a tab */
export async function stopCapture(tabId: number): Promise<void> {
  const sessionId = activeSessions.get(tabId);
  if (!sessionId) return;

  activeSessions.delete(tabId);
  requestCounts.delete(sessionId);

  try {
    await cdpSession.sendCommand(tabId, 'Network.disable');
  } catch {
    // Tab may be closed
  }
  await cdpSession.detach(tabId, CDP_OWNER).catch(() => {});

  console.log(`[UnderPixel] Network capture stopped on tab ${tabId}`);
}

/** Get the session config for filtering decisions */
async function getConfig(sessionId: string): Promise<CaptureConfig> {
  const database = await db();
  const session = await database.get('sessions', sessionId);
  return session?.config || (DEFAULT_CAPTURE_CONFIG as CaptureConfig);
}

function shouldCapture(
  url: string,
  resourceType: string,
  config: CaptureConfig,
): boolean {
  // Resource type filter
  if (!config.includeStatic && !API_RESOURCE_TYPES.includes(resourceType)) {
    return false;
  }

  // Domain filter
  try {
    const domain = new URL(url).hostname;
    if (config.excludeDomains.some((d) => domain.endsWith(d))) {
      return false;
    }
    if (
      config.includeDomains &&
      config.includeDomains.length > 0 &&
      !config.includeDomains.some((d) => domain.endsWith(d))
    ) {
      return false;
    }
  } catch {
    // Invalid URL, skip
    return false;
  }

  return true;
}

// ---- CDP Event Handlers ----

function handleDebuggerEvent(
  source: chrome.debugger.Debuggee,
  method: string,
  params?: Record<string, unknown>,
) {
  const tabId = source.tabId;
  if (!tabId || !activeSessions.has(tabId) || !params) return;
  const sessionId = activeSessions.get(tabId)!;

  switch (method) {
    case 'Network.requestWillBeSent':
      onRequestWillBeSent(tabId, sessionId, params);
      break;
    case 'Network.responseReceived':
      onResponseReceived(tabId, sessionId, params);
      break;
    case 'Network.loadingFinished':
      onLoadingFinished(tabId, sessionId, params);
      break;
    case 'Network.loadingFailed':
      onLoadingFailed(sessionId, params);
      break;
  }
}

async function onRequestWillBeSent(
  tabId: number,
  sessionId: string,
  params: Record<string, unknown>,
) {
  const request = params.request as Record<string, unknown>;
  const requestId = params.requestId as string;
  const url = request.url as string;
  const type = (params.type as string) || 'Other';

  // Check request count limit
  const count = requestCounts.get(sessionId) || 0;
  if (count >= MAX_REQUESTS_PER_SESSION) return;

  // Set stub SYNCHRONOUSLY so response/finish events don't miss it.
  // Filter check is async (needs DB config), so we register first, evict if filtered.
  const nr: NetworkRequest = {
    requestId,
    sessionId,
    url,
    method: (request.method as string) || 'GET',
    status: 'pending',
    type,
    requestHeaders: request.headers as Record<string, string> | undefined,
    requestBody: (request.postData as string) || undefined,
    startTime: Date.now(),
  };
  pendingRequests.set(requestId, nr);

  // Now check filter — evict if this request shouldn't be captured
  const config = await getConfig(sessionId);
  if (!shouldCapture(url, type, config)) {
    pendingRequests.delete(requestId);
  }
}

function onResponseReceived(
  _tabId: number,
  _sessionId: string,
  params: Record<string, unknown>,
) {
  const requestId = params.requestId as string;
  const nr = pendingRequests.get(requestId);
  if (!nr) return;

  const response = params.response as Record<string, unknown>;
  nr.statusCode = response.status as number;
  nr.mimeType = response.mimeType as string;
  nr.responseHeaders = response.headers as Record<string, string> | undefined;
}

async function onLoadingFinished(
  tabId: number,
  sessionId: string,
  params: Record<string, unknown>,
) {
  const requestId = params.requestId as string;
  const nr = pendingRequests.get(requestId);
  if (!nr) return;

  pendingRequests.delete(requestId);
  nr.endTime = Date.now();
  nr.duration = nr.endTime - nr.startTime;
  nr.encodedDataLength = params.encodedDataLength as number | undefined;
  nr.status = 'complete';

  // Fetch response body
  try {
    const result = await cdpSession.sendCommand<{
      body: string;
      base64Encoded: boolean;
    }>(tabId, 'Network.getResponseBody', { requestId });

    const body = result.body;
    if (body.length <= MAX_RESPONSE_BODY_SIZE) {
      if (body.length <= INLINE_BODY_THRESHOLD) {
        nr.responseBody = body;
      } else {
        // Store large body separately
        nr.responseBodyRef = requestId;
        const database = await db();
        await database.put('responseBodies', {
          requestId,
          sessionId,
          body,
          base64Encoded: result.base64Encoded,
        });
      }
    }
    // else: too large, skip
  } catch {
    // Body not available (redirects, aborted, etc.)
  }

  // Write to IndexedDB
  const database = await db();
  await database.put('networkRequests', nr);

  // Update count
  const count = (requestCounts.get(sessionId) || 0) + 1;
  requestCounts.set(sessionId, count);

  // Update session stats
  const session = await database.get('sessions', sessionId);
  if (session) {
    session.stats.networkRequestCount = count;
    await database.put('sessions', session);
  }

  // Notify correlation engine (imported lazily to avoid circular deps)
  try {
    const { correlationEngine } = await import('../correlation/engine');
    correlationEngine.onApiResponse(sessionId, requestId, nr.endTime!);
  } catch {
    // Correlation engine may not be ready yet
  }
}

function onLoadingFailed(sessionId: string, params: Record<string, unknown>) {
  const requestId = params.requestId as string;
  const nr = pendingRequests.get(requestId);
  if (!nr) return;

  pendingRequests.delete(requestId);
  nr.status = 'error';
  nr.endTime = Date.now();
  nr.duration = nr.endTime - nr.startTime;
  nr.errorText = (params.errorText as string) || 'Loading failed';

  // Still store failed requests
  db().then((database) => database.put('networkRequests', nr));
}

function handleDebuggerDetach(
  source: chrome.debugger.Debuggee,
  reason: string,
) {
  const tabId = source.tabId;
  if (tabId && activeSessions.has(tabId)) {
    const sessionId = activeSessions.get(tabId);
    console.warn(
      `[UnderPixel] Debugger detached from tab ${tabId}: ${reason}`,
    );
    activeSessions.delete(tabId);

    // Clean up stranded pending requests for this session
    for (const [id, nr] of pendingRequests) {
      if (nr.sessionId === sessionId) {
        pendingRequests.delete(id);
      }
    }
  }
}

/** Check if capture is active on a tab */
export function isCapturing(tabId: number): boolean {
  return activeSessions.has(tabId);
}

/** Get the session ID for a capturing tab */
export function getSessionId(tabId: number): string | undefined {
  return activeSessions.get(tabId);
}
