import { db } from '../../../lib/storage/db';
import type {
  UnderpixelBundle,
  CaptureSession,
  NetworkRequest,
  StoredRrwebEvent,
  StoredScreenshot,
  CorrelationBundle,
} from 'underpixel-shared';

const INLINE_BODY_THRESHOLD = 100 * 1024; // 100KB — must match capture.ts

/** Validate a parsed bundle. Throws on failure with user-facing messages. */
export function validateBundle(bundle: unknown): asserts bundle is UnderpixelBundle {
  const b = bundle as any;

  if (!b || typeof b !== 'object' || typeof b.version !== 'number') {
    throw new Error("This file doesn't appear to be a valid .underpixel export");
  }

  if (b.version > 1) {
    throw new Error('This file was exported with a newer version of UnderPixel');
  }

  if (
    !b.session ||
    typeof b.session !== 'object' ||
    !b.session.id ||
    b.session.startTime === null ||
    b.session.startTime === undefined ||
    !b.session.initialUrl
  ) {
    throw new Error('This file is missing required session data');
  }

  if (
    !Array.isArray(b.networkRequests) ||
    !Array.isArray(b.rrwebEvents) ||
    !Array.isArray(b.screenshots) ||
    !Array.isArray(b.correlationBundles)
  ) {
    throw new Error("This file doesn't appear to be a valid .underpixel export");
  }
}

/** Re-key all session IDs in a bundle to avoid collisions. Returns a new bundle. */
export function rekeyBundle(bundle: UnderpixelBundle): UnderpixelBundle {
  const newSessionId = crypto.randomUUID();
  const now = Date.now();

  const session: CaptureSession = {
    ...bundle.session,
    id: newSessionId,
    imported: true,
    importedAt: now,
    originalSessionId: bundle.session.id,
  };

  const networkRequests: NetworkRequest[] = bundle.networkRequests.map((r) => ({
    ...r,
    sessionId: newSessionId,
  }));

  const rrwebEvents: StoredRrwebEvent[] = bundle.rrwebEvents.map((e) => ({
    ...e,
    sessionId: newSessionId,
  }));

  const screenshots: StoredScreenshot[] = bundle.screenshots.map((s) => ({
    ...s,
    sessionId: newSessionId,
  }));

  const correlationBundles: CorrelationBundle[] = bundle.correlationBundles.map((b) => ({
    ...b,
    sessionId: newSessionId,
  }));

  return {
    ...bundle,
    session,
    networkRequests,
    rrwebEvents,
    screenshots,
    correlationBundles,
  };
}

/** Decompress a gzipped file, parse, validate, re-key, and write to IDB. Returns new session ID. */
export async function importSession(file: File): Promise<string> {
  // Decompress
  let json: string;
  try {
    const ds = new DecompressionStream('gzip');
    const decompressed = file.stream().pipeThrough(ds);
    const reader = decompressed.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    json = await new Blob(chunks).text();
  } catch {
    throw new Error("This file doesn't appear to be a valid .underpixel export");
  }

  // Parse
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("This file doesn't appear to be a valid .underpixel export");
  }

  // Validate
  validateBundle(parsed);

  // Re-key
  const bundle = rekeyBundle(parsed);
  const newSessionId = bundle.session.id;

  // Write to IDB
  const database = await db();
  const tx = database.transaction(
    [
      'sessions',
      'networkRequests',
      'responseBodies',
      'rrwebEvents',
      'screenshots',
      'correlationBundles',
    ],
    'readwrite',
  );

  tx.objectStore('sessions').put(bundle.session);

  for (const request of bundle.networkRequests) {
    // Split large bodies back into responseBodies store
    if (request.responseBody && request.responseBody.length > INLINE_BODY_THRESHOLD) {
      tx.objectStore('responseBodies').put({
        requestId: request.requestId,
        sessionId: newSessionId,
        body: request.responseBody,
        base64Encoded: false,
      });
      const stored = { ...request };
      stored.responseBodyRef = request.requestId;
      delete (stored as { responseBody?: string }).responseBody;
      tx.objectStore('networkRequests').put(stored);
    } else {
      tx.objectStore('networkRequests').put(request);
    }
  }

  for (const event of bundle.rrwebEvents) {
    tx.objectStore('rrwebEvents').put(event);
  }

  for (const screenshot of bundle.screenshots) {
    tx.objectStore('screenshots').put(screenshot);
  }

  for (const correlationBundle of bundle.correlationBundles) {
    tx.objectStore('correlationBundles').put(correlationBundle);
  }

  await tx.done;

  return newSessionId;
}
