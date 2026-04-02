import { TOOL_NAMES } from 'underpixel-shared';
import { toolRegistry } from './registry';
import { db, getLatestSession } from '../storage/db';

// ---- correlate ----

toolRegistry.register(TOOL_NAMES.CORRELATE, async (args) => {
  const query = args.query as string;
  let sessionId = args.sessionId as string | undefined;

  if (!sessionId) {
    const session = await getLatestSession();
    if (!session) throw new Error('No capture sessions found');
    sessionId = session.id;
  }

  const database = await db();
  const requests = await database.getAllFromIndex(
    'networkRequests',
    'by-session',
    sessionId,
  );
  const bundles = await database.getAllFromIndex(
    'correlationBundles',
    'by-session',
    sessionId,
  );

  const queryLower = query.toLowerCase();

  // Search API response bodies for the query text
  const matchingApis = [];
  for (const r of requests) {
    if (r.status !== 'complete') continue;

    let body = r.responseBody || '';
    if (!body && r.responseBodyRef) {
      const bodyRecord = await database.get('responseBodies', r.responseBodyRef);
      body = bodyRecord?.body || '';
    }

    const urlMatch = r.url.toLowerCase().includes(queryLower);
    const bodyMatch = body.toLowerCase().includes(queryLower);

    if (urlMatch || bodyMatch) {
      matchingApis.push({
        requestId: r.requestId,
        method: r.method,
        url: r.url,
        status: r.statusCode,
        duration: r.duration,
        matchedIn: urlMatch ? 'url' : 'body',
      });
    }
  }

  // Find correlation bundles that reference these APIs
  const matchingBundles = bundles.filter((b) =>
    b.apiCalls.some((id) =>
      matchingApis.some((a) => a.requestId === id),
    ),
  );

  return {
    summary:
      `Found ${matchingApis.length} API calls matching "${query}"` +
      (matchingBundles.length > 0
        ? `, ${matchingBundles.length} with DOM correlations`
        : ''),
    query,
    sessionId,
    matchedApiCalls: matchingApis,
    correlationBundles: matchingBundles.map((b) => ({
      timestamp: b.timestamp,
      trigger: b.trigger,
      correlation: b.correlation,
      domMutationSummary: b.domMutationSummary,
    })),
  };
});

// ---- timeline ----

toolRegistry.register(TOOL_NAMES.TIMELINE, async (args) => {
  let sessionId = args.sessionId as string | undefined;
  const startTime = args.startTime as number | undefined;
  const endTime = args.endTime as number | undefined;
  const limit = (args.limit as number) || 50;

  if (!sessionId) {
    const session = await getLatestSession();
    if (!session) throw new Error('No capture sessions found');
    sessionId = session.id;
  }

  const database = await db();
  let bundles = await database.getAllFromIndex(
    'correlationBundles',
    'by-session',
    sessionId,
  );

  // Apply time range
  if (startTime) bundles = bundles.filter((b) => b.timestamp >= startTime);
  if (endTime) bundles = bundles.filter((b) => b.timestamp <= endTime);

  // Sort and limit
  bundles.sort((a, b) => a.timestamp - b.timestamp);
  bundles = bundles.slice(0, limit);

  return {
    summary: `${bundles.length} correlation bundles in timeline`,
    sessionId,
    bundles: bundles.map((b) => ({
      timestamp: b.timestamp,
      trigger: b.trigger,
      correlation: b.correlation,
      domMutationSummary: b.domMutationSummary,
      screenshotId: b.screenshotId,
    })),
  };
});

// ---- snapshot_at ----

toolRegistry.register(TOOL_NAMES.SNAPSHOT_AT, async (args) => {
  const timestamp = args.timestamp as number;
  let sessionId = args.sessionId as string | undefined;

  if (!sessionId) {
    const session = await getLatestSession();
    if (!session) throw new Error('No capture sessions found');
    sessionId = session.id;
  }

  const database = await db();

  // Find closest screenshot
  const screenshots = await database.getAllFromIndex(
    'screenshots',
    'by-session',
    sessionId,
  );
  let closestScreenshot = null;
  let minDist = Infinity;
  for (const s of screenshots) {
    const dist = Math.abs(s.timestamp - timestamp);
    if (dist < minDist) {
      minDist = dist;
      closestScreenshot = s;
    }
  }

  // Find API calls active around that timestamp (within 1 second)
  const requests = await database.getAllFromIndex(
    'networkRequests',
    'by-session',
    sessionId,
  );
  const nearbyApis = requests.filter(
    (r) =>
      r.startTime <= timestamp + 1000 &&
      (r.endTime ? r.endTime >= timestamp - 1000 : true),
  );

  return {
    summary: `Snapshot at ${new Date(timestamp).toISOString()}`,
    timestamp,
    sessionId,
    screenshot: closestScreenshot
      ? {
          id: closestScreenshot.id,
          dataUrl: closestScreenshot.dataUrl,
          timestamp: closestScreenshot.timestamp,
          trigger: closestScreenshot.trigger,
        }
      : null,
    apiCalls: nearbyApis.map((r) => ({
      method: r.method,
      url: r.url,
      status: r.statusCode,
      startTime: r.startTime,
      endTime: r.endTime,
      duration: r.duration,
    })),
  };
});

// ---- replay (stub — opens extension page) ----

toolRegistry.register(TOOL_NAMES.REPLAY, async (args) => {
  let sessionId = args.sessionId as string | undefined;
  if (!sessionId) {
    const session = await getLatestSession();
    if (!session) throw new Error('No capture sessions found');
    sessionId = session.id;
  }

  const replayUrl = chrome.runtime.getURL(
    `replay.html?sessionId=${sessionId}`,
  );
  const tab = await chrome.tabs.create({ url: replayUrl });

  return {
    summary: `Replay opened in new tab`,
    replayUrl,
    tabId: tab.id,
    sessionId,
  };
});

// ---- api_dependencies ----

toolRegistry.register(TOOL_NAMES.API_DEPENDENCIES, async (args) => {
  let sessionId = args.sessionId as string | undefined;
  if (!sessionId) {
    const session = await getLatestSession();
    if (!session) throw new Error('No capture sessions found');
    sessionId = session.id;
  }

  const database = await db();
  const requests = await database.getAllFromIndex(
    'networkRequests',
    'by-session',
    sessionId,
  );

  // Only consider completed requests with response bodies
  const completed = requests
    .filter((r) => r.status === 'complete')
    .sort((a, b) => a.startTime - b.startTime);

  const edges: Array<{
    from: { url: string; method: string };
    to: { url: string; method: string };
    via: string;
    valueType: string;
  }> = [];

  for (let i = 0; i < completed.length; i++) {
    const source = completed[i];
    let body = source.responseBody || '';
    if (!body && source.responseBodyRef) {
      const bodyRecord = await database.get('responseBodies', source.responseBodyRef);
      body = bodyRecord?.body || '';
    }
    if (!body) continue;

    const trackable = extractTrackableValues(body);
    if (trackable.size === 0) continue;

    for (let j = i + 1; j < completed.length; j++) {
      const target = completed[j];
      const searchSpace = [
        target.url,
        target.requestHeaders?.authorization || '',
        target.requestBody || '',
      ].join(' ');

      for (const [value, type] of trackable) {
        if (searchSpace.includes(value)) {
          edges.push({
            from: { url: source.url, method: source.method },
            to: { url: target.url, method: target.method },
            via: value.length > 20 ? value.substring(0, 20) + '...' : value,
            valueType: type,
          });
          break; // One edge per pair
        }
      }
    }
  }

  return {
    summary: `${edges.length} dependency edges found across ${completed.length} API calls`,
    sessionId,
    edges,
  };
});

function extractTrackableValues(body: string): Map<string, string> {
  const values = new Map<string, string>();
  try {
    const parsed = JSON.parse(body);
    walkJson(parsed, (key, value) => {
      if (typeof value === 'string') {
        if (value.startsWith('eyJ') && value.length > 30) {
          values.set(value, 'jwt');
        } else if (
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
        ) {
          values.set(value, 'uuid');
        } else if (value.length >= 20 && /^[A-Za-z0-9+/=_-]+$/.test(value)) {
          values.set(value, 'token');
        }
      }
      if (typeof value === 'number' && typeof key === 'string' && /id$/i.test(key)) {
        values.set(String(value), 'id');
      }
    });
  } catch {
    // Not JSON
  }
  return values;
}

function walkJson(
  obj: unknown,
  cb: (key: string | number, value: unknown) => void,
  key: string | number = '',
): void {
  if (obj === null || obj === undefined) return;
  cb(key, obj);
  if (typeof obj === 'object') {
    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) walkJson(obj[i], cb, i);
    } else {
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        walkJson(v, cb, k);
      }
    }
  }
}
