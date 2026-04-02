import { TOOL_NAMES } from 'underpixel-shared';
import { toolRegistry } from './registry';
import { db, getLatestSession } from '../storage/db';
import { findDomElements, collectMatchedNodeValues } from '../correlation/dom-walker';

// ---- Value-level correlation helpers ----

/** Walk a JSON object once, indexing every leaf value → its JSON path(s). */
function buildLeafMap(obj: unknown, out: Map<string, string[]>, path = ''): void {
  if (obj === null || obj === undefined) return;

  if (typeof obj === 'string') {
    const list = out.get(obj);
    if (list) list.push(path); else out.set(obj, [path]);
    return;
  }
  if (typeof obj === 'number' || typeof obj === 'boolean') {
    const s = String(obj);
    const list = out.get(s);
    if (list) list.push(path); else out.set(s, [path]);
    return;
  }
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      buildLeafMap(obj[i], out, `${path}[${i}]`);
    }
    return;
  }
  if (typeof obj === 'object') {
    for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
      buildLeafMap(val, out, path ? `${path}.${key}` : key);
    }
  }
}

/** Result shape for a value-level correlation hit */
interface ValueCorrelation {
  domValue: string;
  apiRequestId: string;
  apiUrl: string;
  apiMethod: string;
  jsonPath: string;
}

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

  // Parallel fetch: requests, bundles, rrweb events, and session config
  const [requests, bundles, rrwebEvents, session] = await Promise.all([
    database.getAllFromIndex('networkRequests', 'by-session', sessionId),
    database.getAllFromIndex('correlationBundles', 'by-session', sessionId),
    database.getAllFromIndex(
      'rrwebEvents',
      'by-session-time',
      IDBKeyRange.bound([sessionId, 0], [sessionId, Date.now()]),
    ),
    database.get('sessions', sessionId),
  ]);

  const correlationWindowMs = session?.config?.correlationWindow ?? 500;

  // Build request lookup map for O(1) access by requestId
  const requestsById = new Map(requests.map((r) => [r.requestId, r]));

  // ── Forward path: text search on API URLs + response bodies ──

  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(/\s+/).filter((w) => w.length > 0);

  const forwardMatchIds = new Set<string>();
  const matchingApis: Array<{
    requestId: string;
    method: string;
    url: string;
    status?: number;
    duration?: number;
    matchedIn: string;
    confidence: string;
  }> = [];

  // Batch-fetch response bodies stored by reference (avoids N+1 serial IDB reads)
  const bodyRefs = requests
    .filter((r) => r.status === 'complete' && !r.responseBody && r.responseBodyRef)
    .map((r) => r.responseBodyRef!);
  const bodyRecords = await Promise.all(
    bodyRefs.map((ref) => database.get('responseBodies', ref)),
  );
  const bodyByRef = new Map(
    bodyRefs.map((ref, i) => [ref, bodyRecords[i]?.body ?? '']),
  );
  const resolveBody = (r: typeof requests[number]) =>
    r.responseBody || bodyByRef.get(r.responseBodyRef!) || '';

  for (const r of requests) {
    if (r.status !== 'complete') continue;

    const body = resolveBody(r);
    const searchText = (r.url + ' ' + body).toLowerCase();
    const allWordsMatch = queryWords.every((w) => searchText.includes(w));

    if (allWordsMatch) {
      const urlMatch = queryWords.some((w) => r.url.toLowerCase().includes(w));
      forwardMatchIds.add(r.requestId);
      matchingApis.push({
        requestId: r.requestId,
        method: r.method,
        url: r.url,
        status: r.statusCode,
        duration: r.duration,
        matchedIn: urlMatch ? 'url' : 'body',
        confidence: 'forward-only',
      });
    }
  }

  // ── Reverse path: DOM element search via rrweb snapshots + mutations ──

  const domMatches = findDomElements(query, rrwebEvents);

  // For each DOM match timestamp, find API requests that completed within ±1s
  // (same window as snapshot_at tool) and that have correlation bundles
  const reverseMatchIds = new Set<string>();
  if (domMatches.length > 0) {
    // Collect all DOM match timestamps for bundle matching
    const domTimestamps = domMatches.map((m) => m.timestamp);

    // Find bundles whose correlation window overlaps with DOM matches
    for (const bundle of bundles) {
      const bundleOverlaps = domTimestamps.some(
        (t) => Math.abs(t - bundle.timestamp) <= correlationWindowMs,
      );
      if (bundleOverlaps) {
        for (const apiId of bundle.apiCalls) {
          reverseMatchIds.add(apiId);
        }
      }
    }

    // Add reverse-only matches that forward path didn't find
    for (const reqId of reverseMatchIds) {
      if (forwardMatchIds.has(reqId)) continue;
      const r = requestsById.get(reqId);
      if (!r || r.status !== 'complete') continue;
      matchingApis.push({
        requestId: r.requestId,
        method: r.method,
        url: r.url,
        status: r.statusCode,
        duration: r.duration,
        matchedIn: 'dom-reverse',
        confidence: 'reverse-only',
      });
    }
  }

  // ── Confidence scoring ──
  // APIs found by BOTH paths get 'high' confidence
  for (const api of matchingApis) {
    if (forwardMatchIds.has(api.requestId) && reverseMatchIds.has(api.requestId)) {
      api.confidence = 'high';
    }
  }

  // ── Find correlation bundles that reference any matched API ──

  const matchingBundles = bundles.filter((b) =>
    b.apiCalls.some((id) => forwardMatchIds.has(id) || reverseMatchIds.has(id)),
  );

  // ── Value-level correlation: match DOM text to API response JSON fields ──
  const valueCorrelations: ValueCorrelation[] = [];

  if (domMatches.length > 0 && requests.length > 0) {
    const domValues = collectMatchedNodeValues(rrwebEvents, domMatches);

    if (domValues.length > 0 && domValues.length <= 500) {
      const allMatchedIds = new Set([...forwardMatchIds, ...reverseMatchIds]);
      const apisToSearch = requests
        .filter((r) => r.status === 'complete')
        .sort((a, b) => (allMatchedIds.has(b.requestId) ? 1 : 0) - (allMatchedIds.has(a.requestId) ? 1 : 0))
        .slice(0, 30);

      const seen = new Set<string>();
      const domValueSet = new Set(domValues);

      for (const r of apisToSearch) {
        if (valueCorrelations.length >= 50) break;
        const body = resolveBody(r);
        if (!body) continue;

        let parsed: unknown;
        try {
          parsed = JSON.parse(body);
        } catch {
          continue;
        }

        // Walk JSON once per API → O(nodes), then probe domValues via map lookup
        const leafMap = new Map<string, string[]>();
        buildLeafMap(parsed, leafMap);

        for (const domValue of domValueSet) {
          if (valueCorrelations.length >= 50) break;
          const paths = leafMap.get(domValue);
          if (!paths) continue;

          for (const jsonPath of paths) {
            const key = `${domValue}\0${r.requestId}\0${jsonPath}`;
            if (seen.has(key)) continue;
            seen.add(key);

            valueCorrelations.push({
              domValue: domValue.length > 80 ? domValue.substring(0, 80) + '...' : domValue,
              apiRequestId: r.requestId,
              apiUrl: r.url,
              apiMethod: r.method,
              jsonPath,
            });
          }
        }
      }
    }
  }

  return {
    summary:
      `Found ${matchingApis.length} API calls matching "${query}"` +
      (domMatches.length > 0
        ? ` (${domMatches.length} DOM elements matched)`
        : '') +
      (matchingBundles.length > 0
        ? `, ${matchingBundles.length} with DOM correlations`
        : '') +
      (valueCorrelations.length > 0
        ? `, ${valueCorrelations.length} value-level matches`
        : ''),
    query,
    sessionId,
    matchedApiCalls: matchingApis,
    correlationBundles: matchingBundles.map((b) => ({
      timestamp: b.timestamp,
      trigger: b.trigger,
      correlation: b.correlation,
      domMutationSummary: b.domMutationSummary,
      rrwebEventIds: domMatches
        .filter((m) => Math.abs(m.timestamp - b.timestamp) <= correlationWindowMs)
        .map((m) => m.rrwebEventId),
    })),
    domMatches: domMatches.slice(0, 20),
    valueCorrelations,
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

  // Find closest screenshot — check both session screenshots and on-demand (sessionId: '')
  const [sessionScreenshots, onDemandScreenshots] = await Promise.all([
    database.getAllFromIndex('screenshots', 'by-session', sessionId),
    database.getAllFromIndex('screenshots', 'by-session', ''),
  ]);
  const allScreenshots = [...sessionScreenshots, ...onDemandScreenshots];

  let closestScreenshot = null;
  let minDist = Infinity;
  for (const s of allScreenshots) {
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

  // Batch-fetch referenced response bodies (avoids N serial IDB reads)
  const depBodyRefs = completed
    .filter((r) => !r.responseBody && r.responseBodyRef)
    .map((r) => r.responseBodyRef!);
  const depBodyRecords = await Promise.all(
    depBodyRefs.map((ref) => database.get('responseBodies', ref)),
  );
  const depBodyByRef = new Map(
    depBodyRefs.map((ref, i) => [ref, depBodyRecords[i]?.body ?? '']),
  );

  const edges: Array<{
    from: { url: string; method: string };
    to: { url: string; method: string };
    via: string;
    valueType: string;
  }> = [];

  for (let i = 0; i < completed.length; i++) {
    const source = completed[i];
    const body = source.responseBody || depBodyByRef.get(source.responseBodyRef!) || '';
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
        // JWTs (base64url-encoded JSON, always start with eyJ)
        if (value.startsWith('eyJ') && value.length > 30) {
          values.set(value, 'jwt');
        }
        // UUIDs
        else if (
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
        ) {
          values.set(value, 'uuid');
        }
        // Hex hashes (SHA-1, SHA-256, etc.)
        else if (/^[0-9a-f]{32,}$/i.test(value)) {
          values.set(value, 'token');
        }
        // High-entropy tokens: 32+ chars, no spaces/dashes/dots, mixed with digits
        // Excludes readable slugs like "firecrawl-claude-plugin"
        else if (
          value.length >= 32 &&
          /^[A-Za-z0-9+/=_]+$/.test(value) && // no dashes (excludes slugs)
          /\d/.test(value) // must contain at least one digit (excludes plain words)
        ) {
          values.set(value, 'token');
        }
      }
      // Numeric IDs from keys ending in "id" (e.g., userId, projectId)
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
