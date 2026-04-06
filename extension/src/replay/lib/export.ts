import { db } from '../../../lib/storage/db';
import type {
  NetworkRequest,
  StoredRrwebEvent,
  StoredScreenshot,
  CorrelationBundle,
  ExportOptions,
  UnderpixelBundle,
} from 'underpixel-shared';

export const DEFAULT_MASKED_HEADERS = ['authorization', 'cookie', 'set-cookie', 'x-api-key'];

export function sanitizeFilename(title: string): string {
  return title
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

export function applyExportOptions(
  requests: NetworkRequest[],
  screenshots: StoredScreenshot[],
  bundles: CorrelationBundle[],
  options: ExportOptions,
): {
  requests: NetworkRequest[];
  screenshots: StoredScreenshot[];
  bundles: CorrelationBundle[];
} {
  let processedRequests = requests.map((r) => ({ ...r }));
  let processedScreenshots = [...screenshots];
  let processedBundles = bundles.map((b) => ({ ...b }));

  if (!options.includeScreenshots) {
    processedScreenshots = [];
    processedBundles = processedBundles.map((b) => {
      const copy = { ...b };
      delete (copy as { screenshotId?: string }).screenshotId;
      return copy;
    });
  }

  if (!options.includeResponseBodies) {
    processedRequests = processedRequests.map((r) => {
      const copy = { ...r };
      delete (copy as { responseBody?: string }).responseBody;
      return copy;
    });
  }

  if (options.maskSensitiveHeaders) {
    const lowerNames = new Set(options.maskedHeaderNames.map((n) => n.toLowerCase()));

    processedRequests = processedRequests.map((r) => {
      const copy = { ...r };
      if (copy.requestHeaders) {
        copy.requestHeaders = maskHeaders(copy.requestHeaders, lowerNames);
      }
      if (copy.responseHeaders) {
        copy.responseHeaders = maskHeaders(copy.responseHeaders, lowerNames);
      }
      return copy;
    });
  }

  return {
    requests: processedRequests,
    screenshots: processedScreenshots,
    bundles: processedBundles,
  };
}

function maskHeaders(
  headers: Record<string, string>,
  maskedNames: Set<string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    result[key] = maskedNames.has(key.toLowerCase()) ? '[MASKED]' : value;
  }
  return result;
}

/** Read all session data from IDB, assemble bundle, compress, and trigger download. */
export async function exportSession(sessionId: string, options: ExportOptions): Promise<void> {
  const database = await db();

  // Read all stores in parallel
  const [session, requests, bodies, events, screenshots, bundles] = await Promise.all([
    database.get('sessions', sessionId),
    database.getAllFromIndex('networkRequests', 'by-session', sessionId),
    database.getAllFromIndex('responseBodies', 'by-session', sessionId),
    database.getAllFromIndex('rrwebEvents', 'by-session', sessionId),
    database.getAllFromIndex('screenshots', 'by-session', sessionId),
    database.getAllFromIndex('correlationBundles', 'by-session', sessionId),
  ]);

  if (!session) throw new Error(`Session ${sessionId} not found`);

  // Re-inline response bodies
  const bodyMap = new Map(bodies.map((b) => [b.requestId, b.body]));
  const inlinedRequests = requests.map((r) => {
    if (r.responseBodyRef && bodyMap.has(r.responseBodyRef)) {
      const copy = { ...r };
      copy.responseBody = bodyMap.get(r.responseBodyRef);
      delete (copy as { responseBodyRef?: string }).responseBodyRef;
      return copy;
    }
    return r;
  });

  // Apply export options
  const processed = applyExportOptions(inlinedRequests, screenshots, bundles, options);

  const bundle: UnderpixelBundle = {
    version: 1,
    exportedAt: Date.now(),
    exportOptions: options,
    session,
    networkRequests: processed.requests,
    rrwebEvents: events as StoredRrwebEvent[],
    screenshots: processed.screenshots,
    correlationBundles: processed.bundles,
  };

  // Compress
  const json = JSON.stringify(bundle);
  const encoded = new TextEncoder().encode(json);
  const cs = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  writer.write(encoded);
  writer.close();

  const chunks: Uint8Array[] = [];
  const reader = cs.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const blob = new Blob(chunks, { type: 'application/gzip' });

  // Download
  const date = new Date().toISOString().slice(0, 10);
  const name = sanitizeFilename(session.initialTitle) || 'session';
  const filename = `${name}-${date}.underpixel`;

  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}
