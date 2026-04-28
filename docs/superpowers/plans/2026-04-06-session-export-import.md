# Session Export/Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable exporting captured sessions as `.underpixel` files (gzipped JSON) and importing them back into the replay UI as first-class IndexedDB sessions.

**Architecture:** Export reads all 6 IDB stores for a session, re-inlines large response bodies, applies user-chosen options (mask headers, exclude screenshots/bodies), compresses via browser-native `CompressionStream`, and triggers a file download. Import reverses the process: decompress, validate, re-key IDs to avoid collisions, split large bodies back to the `responseBodies` store, and write to IDB in a single transaction.

**Tech Stack:** TypeScript, Svelte 5 (legacy mode), IndexedDB (`idb` library), browser-native CompressionStream/DecompressionStream, Vitest.

**Spec:** `docs/superpowers/specs/2026-04-06-session-export-import-design.md`

---

## File Structure

| File                                                            | Responsibility                                                                         |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `packages/shared/src/types.ts` (modify)                         | Add `UnderpixelBundle`, `ExportOptions`, and import-related fields to `CaptureSession` |
| `extension/src/replay/lib/export.ts` (create)                   | Export logic: read IDB, apply options, compress, download                              |
| `extension/src/replay/lib/export.test.ts` (create)              | Tests for export serialization and option application                                  |
| `extension/src/replay/lib/import.ts` (create)                   | Import logic: decompress, validate, re-key, write to IDB                               |
| `extension/src/replay/lib/import.test.ts` (create)              | Tests for import validation, re-keying, body splitting                                 |
| `extension/src/replay/components/ExportModal.svelte` (create)   | Options modal for export configuration                                                 |
| `extension/entrypoints/replay/App.svelte` (modify)              | Wire Export click, add Import button, show toast errors                                |
| `extension/src/replay/components/SessionPicker.svelte` (modify) | Show "Imported" badge on imported sessions                                             |

---

### Task 1: Add shared types

**Files:**

- Modify: `packages/shared/src/types.ts`

- [ ] **Step 1: Add export/import types to shared types**

Add these types at the end of `packages/shared/src/types.ts`, and add the optional import fields to `CaptureSession`:

```typescript
// In CaptureSession interface, add after the `stats` field:
  imported?: boolean;
  importedAt?: number;
  originalSessionId?: string;

// At the end of the file, add:

export interface ExportOptions {
  includeScreenshots: boolean;
  includeResponseBodies: boolean;
  maskSensitiveHeaders: boolean;
  maskedHeaderNames: string[];
}

export interface UnderpixelBundle {
  version: 1;
  exportedAt: number;
  exportOptions: ExportOptions;
  session: CaptureSession;
  networkRequests: NetworkRequest[];
  rrwebEvents: StoredRrwebEvent[];
  screenshots: StoredScreenshot[];
  correlationBundles: CorrelationBundle[];
}
```

- [ ] **Step 2: Build shared package**

Run: `cd underpixel && pnpm --filter underpixel-shared build`
Expected: Clean build, no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/types.ts
git commit -m "feat: add UnderpixelBundle and ExportOptions types for session export/import"
```

---

### Task 2: Export serialization logic (TDD)

**Files:**

- Create: `extension/src/replay/lib/export.ts`
- Create: `extension/src/replay/lib/export.test.ts`

- [ ] **Step 1: Write failing tests for export helpers**

Create `extension/src/replay/lib/export.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { sanitizeFilename, applyExportOptions, DEFAULT_MASKED_HEADERS } from './export';
import type {
  CaptureSession,
  NetworkRequest,
  StoredScreenshot,
  CorrelationBundle,
  ExportOptions,
} from 'underpixel-shared';

// -- Fixtures --

function makeSession(overrides: Partial<CaptureSession> = {}): CaptureSession {
  return {
    id: 'sess-1',
    startTime: 1000,
    initialUrl: 'https://example.com',
    initialTitle: 'Example Page',
    tabId: 1,
    status: 'stopped',
    config: {
      includeStatic: false,
      excludeDomains: [],
      maxResponseBodySize: 1_000_000,
      screenshotsEnabled: true,
      maxScreenshotsPerSession: 100,
      screenshotInterval: 500,
      pixelDiffThreshold: 0.01,
      correlationWindow: 500,
      rrwebSampling: { mousemove: 100, scroll: 150, input: 'last' },
      maskInputs: false,
    },
    stats: {
      networkRequestCount: 0,
      rrwebEventCount: 0,
      screenshotCount: 0,
      correlationBundleCount: 0,
    },
    ...overrides,
  };
}

function makeRequest(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    requestId: 'req-1',
    sessionId: 'sess-1',
    url: 'https://api.example.com/data',
    method: 'GET',
    status: 'complete',
    statusCode: 200,
    type: 'fetch',
    startTime: 1000,
    endTime: 1200,
    requestHeaders: { authorization: 'Bearer secret', 'content-type': 'application/json' },
    responseHeaders: { 'set-cookie': 'sid=abc123', 'content-type': 'application/json' },
    responseBody: '{"ok":true}',
    ...overrides,
  };
}

function makeScreenshot(overrides: Partial<StoredScreenshot> = {}): StoredScreenshot {
  return {
    id: 'ss-1',
    sessionId: 'sess-1',
    timestamp: 1100,
    dataUrl: 'data:image/jpeg;base64,/9j/4AAQ...',
    width: 1920,
    height: 1080,
    trigger: 'api-response',
    ...overrides,
  };
}

function makeBundle(overrides: Partial<CorrelationBundle> = {}): CorrelationBundle {
  return {
    id: 'bun-1',
    sessionId: 'sess-1',
    timestamp: 1100,
    trigger: 'API: GET /data',
    apiCalls: ['req-1'],
    rrwebEventIds: [1, 2],
    screenshotId: 'ss-1',
    correlation: 'GET /data → 2 DOM mutations',
    ...overrides,
  };
}

// -- Tests --

describe('sanitizeFilename', () => {
  it('replaces non-alphanumeric chars with hyphens', () => {
    expect(sanitizeFilename('Hello World! @#$')).toBe('Hello-World');
  });

  it('collapses consecutive hyphens', () => {
    expect(sanitizeFilename('a---b___c')).toBe('a-b-c');
  });

  it('trims to 60 characters', () => {
    const long = 'A'.repeat(100);
    expect(sanitizeFilename(long).length).toBeLessThanOrEqual(60);
  });

  it('strips leading/trailing hyphens', () => {
    expect(sanitizeFilename('--hello--')).toBe('hello');
  });
});

describe('applyExportOptions', () => {
  const defaultOptions: ExportOptions = {
    includeScreenshots: true,
    includeResponseBodies: true,
    maskSensitiveHeaders: false,
    maskedHeaderNames: DEFAULT_MASKED_HEADERS,
  };

  it('returns data unchanged with default options', () => {
    const requests = [makeRequest()];
    const screenshots = [makeScreenshot()];
    const bundles = [makeBundle()];
    const result = applyExportOptions(requests, screenshots, bundles, defaultOptions);

    expect(result.requests[0].responseBody).toBe('{"ok":true}');
    expect(result.screenshots).toHaveLength(1);
    expect(result.requests[0].requestHeaders!.authorization).toBe('Bearer secret');
  });

  it('strips screenshots when includeScreenshots is false', () => {
    const options = { ...defaultOptions, includeScreenshots: false };
    const result = applyExportOptions([makeRequest()], [makeScreenshot()], [makeBundle()], options);

    expect(result.screenshots).toHaveLength(0);
    expect(result.bundles[0].screenshotId).toBeUndefined();
  });

  it('strips response bodies when includeResponseBodies is false', () => {
    const options = { ...defaultOptions, includeResponseBodies: false };
    const result = applyExportOptions([makeRequest()], [makeScreenshot()], [makeBundle()], options);

    expect(result.requests[0].responseBody).toBeUndefined();
  });

  it('masks sensitive headers when maskSensitiveHeaders is true', () => {
    const options = { ...defaultOptions, maskSensitiveHeaders: true };
    const result = applyExportOptions([makeRequest()], [makeScreenshot()], [makeBundle()], options);

    expect(result.requests[0].requestHeaders!.authorization).toBe('[MASKED]');
    expect(result.requests[0].responseHeaders!['set-cookie']).toBe('[MASKED]');
    // Non-sensitive headers untouched
    expect(result.requests[0].requestHeaders!['content-type']).toBe('application/json');
  });

  it('uses custom maskedHeaderNames', () => {
    const options = {
      ...defaultOptions,
      maskSensitiveHeaders: true,
      maskedHeaderNames: ['content-type'],
    };
    const result = applyExportOptions([makeRequest()], [makeScreenshot()], [makeBundle()], options);

    expect(result.requests[0].requestHeaders!['content-type']).toBe('[MASKED]');
    // authorization NOT masked since it's not in custom list
    expect(result.requests[0].requestHeaders!.authorization).toBe('Bearer secret');
  });

  it('does not mutate original arrays', () => {
    const requests = [makeRequest()];
    const screenshots = [makeScreenshot()];
    const bundles = [makeBundle()];
    const options = {
      ...defaultOptions,
      includeScreenshots: false,
      maskSensitiveHeaders: true,
    };

    applyExportOptions(requests, screenshots, bundles, options);

    // Originals unchanged
    expect(requests[0].requestHeaders!.authorization).toBe('Bearer secret');
    expect(screenshots).toHaveLength(1);
    expect(bundles[0].screenshotId).toBe('ss-1');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd underpixel && pnpm --filter extension test -- --run src/replay/lib/export.test.ts`
Expected: FAIL — module `./export` not found.

- [ ] **Step 3: Implement export helpers**

Create `extension/src/replay/lib/export.ts`:

```typescript
import { db } from '../../../lib/storage/db';
import type {
  CaptureSession,
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
    rrwebEvents: events,
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
  const name = sanitizeFilename(session.initialTitle);
  const filename = `${name}-${date}.underpixel`;

  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd underpixel && pnpm --filter extension test -- --run src/replay/lib/export.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add extension/src/replay/lib/export.ts extension/src/replay/lib/export.test.ts
git commit -m "feat: add session export logic with sanitizeFilename, applyExportOptions, and exportSession"
```

---

### Task 3: Import validation and re-keying logic (TDD)

**Files:**

- Create: `extension/src/replay/lib/import.ts`
- Create: `extension/src/replay/lib/import.test.ts`

- [ ] **Step 1: Write failing tests for import helpers**

Create `extension/src/replay/lib/import.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { validateBundle, rekeyBundle } from './import';
import type { UnderpixelBundle, ExportOptions, CaptureSession } from 'underpixel-shared';

function makeValidBundle(overrides: Partial<UnderpixelBundle> = {}): UnderpixelBundle {
  return {
    version: 1,
    exportedAt: Date.now(),
    exportOptions: {
      includeScreenshots: true,
      includeResponseBodies: true,
      maskSensitiveHeaders: false,
      maskedHeaderNames: [],
    },
    session: {
      id: 'orig-sess',
      startTime: 1000,
      initialUrl: 'https://example.com',
      initialTitle: 'Example',
      tabId: 1,
      status: 'stopped',
      config: {
        includeStatic: false,
        excludeDomains: [],
        maxResponseBodySize: 1_000_000,
        screenshotsEnabled: true,
        maxScreenshotsPerSession: 100,
        screenshotInterval: 500,
        pixelDiffThreshold: 0.01,
        correlationWindow: 500,
        rrwebSampling: { mousemove: 100, scroll: 150, input: 'last' },
        maskInputs: false,
      },
      stats: {
        networkRequestCount: 1,
        rrwebEventCount: 2,
        screenshotCount: 1,
        correlationBundleCount: 1,
      },
    } as CaptureSession,
    networkRequests: [
      {
        requestId: 'req-1',
        sessionId: 'orig-sess',
        url: 'https://api.example.com/data',
        method: 'GET',
        status: 'complete',
        statusCode: 200,
        type: 'fetch',
        startTime: 1000,
        responseBody: '{"ok":true}',
      },
    ],
    rrwebEvents: [
      { sessionId: 'orig-sess', timestamp: 1000, type: 2, data: {} },
      { sessionId: 'orig-sess', timestamp: 1100, type: 3, data: {} },
    ],
    screenshots: [
      {
        id: 'ss-1',
        sessionId: 'orig-sess',
        timestamp: 1100,
        dataUrl: 'data:image/jpeg;base64,abc',
        width: 1920,
        height: 1080,
        trigger: 'api-response',
      },
    ],
    correlationBundles: [
      {
        id: 'bun-1',
        sessionId: 'orig-sess',
        timestamp: 1100,
        trigger: 'API: GET /data',
        apiCalls: ['req-1'],
        rrwebEventIds: [1, 2],
        screenshotId: 'ss-1',
        correlation: 'GET /data → mutations',
      },
    ],
    ...overrides,
  } as UnderpixelBundle;
}

describe('validateBundle', () => {
  it('accepts a valid bundle', () => {
    expect(() => validateBundle(makeValidBundle())).not.toThrow();
  });

  it('rejects missing version', () => {
    const bundle = makeValidBundle();
    delete (bundle as any).version;
    expect(() => validateBundle(bundle)).toThrow('valid .underpixel export');
  });

  it('rejects unsupported version', () => {
    const bundle = makeValidBundle();
    (bundle as any).version = 2;
    expect(() => validateBundle(bundle)).toThrow('newer version');
  });

  it('rejects missing session', () => {
    const bundle = makeValidBundle();
    delete (bundle as any).session;
    expect(() => validateBundle(bundle)).toThrow('missing required session data');
  });

  it('rejects session without id', () => {
    const bundle = makeValidBundle();
    delete (bundle.session as any).id;
    expect(() => validateBundle(bundle)).toThrow('missing required session data');
  });

  it('rejects session without startTime', () => {
    const bundle = makeValidBundle();
    delete (bundle.session as any).startTime;
    expect(() => validateBundle(bundle)).toThrow('missing required session data');
  });

  it('rejects session without initialUrl', () => {
    const bundle = makeValidBundle();
    delete (bundle.session as any).initialUrl;
    expect(() => validateBundle(bundle)).toThrow('missing required session data');
  });

  it('rejects non-array networkRequests', () => {
    const bundle = makeValidBundle();
    (bundle as any).networkRequests = 'not-an-array';
    expect(() => validateBundle(bundle)).toThrow('valid .underpixel export');
  });

  it('rejects non-array rrwebEvents', () => {
    const bundle = makeValidBundle();
    (bundle as any).rrwebEvents = null;
    expect(() => validateBundle(bundle)).toThrow('valid .underpixel export');
  });
});

describe('rekeyBundle', () => {
  it('generates a new session id', () => {
    const bundle = makeValidBundle();
    const rekeyed = rekeyBundle(bundle);
    expect(rekeyed.session.id).not.toBe('orig-sess');
    expect(rekeyed.session.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('stores original session id', () => {
    const bundle = makeValidBundle();
    const rekeyed = rekeyBundle(bundle);
    expect(rekeyed.session.originalSessionId).toBe('orig-sess');
  });

  it('marks session as imported', () => {
    const bundle = makeValidBundle();
    const rekeyed = rekeyBundle(bundle);
    expect(rekeyed.session.imported).toBe(true);
    expect(rekeyed.session.importedAt).toBeGreaterThan(0);
  });

  it('updates sessionId on all network requests', () => {
    const bundle = makeValidBundle();
    const rekeyed = rekeyBundle(bundle);
    const newId = rekeyed.session.id;
    for (const r of rekeyed.networkRequests) {
      expect(r.sessionId).toBe(newId);
    }
  });

  it('updates sessionId on all rrweb events', () => {
    const bundle = makeValidBundle();
    const rekeyed = rekeyBundle(bundle);
    const newId = rekeyed.session.id;
    for (const e of rekeyed.rrwebEvents) {
      expect(e.sessionId).toBe(newId);
    }
  });

  it('updates sessionId on all screenshots', () => {
    const bundle = makeValidBundle();
    const rekeyed = rekeyBundle(bundle);
    const newId = rekeyed.session.id;
    for (const s of rekeyed.screenshots) {
      expect(s.sessionId).toBe(newId);
    }
  });

  it('updates sessionId on all correlation bundles', () => {
    const bundle = makeValidBundle();
    const rekeyed = rekeyBundle(bundle);
    const newId = rekeyed.session.id;
    for (const b of rekeyed.correlationBundles) {
      expect(b.sessionId).toBe(newId);
    }
  });

  it('does not mutate original bundle', () => {
    const bundle = makeValidBundle();
    rekeyBundle(bundle);
    expect(bundle.session.id).toBe('orig-sess');
    expect(bundle.networkRequests[0].sessionId).toBe('orig-sess');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd underpixel && pnpm --filter extension test -- --run src/replay/lib/import.test.ts`
Expected: FAIL — module `./import` not found.

- [ ] **Step 3: Implement import helpers**

Create `extension/src/replay/lib/import.ts`:

```typescript
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
    b.session.startTime == null ||
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

/** Generate a v4 UUID */
function uuid(): string {
  return crypto.randomUUID();
}

/** Re-key all session IDs in a bundle to avoid collisions. Returns a new bundle. */
export function rekeyBundle(bundle: UnderpixelBundle): UnderpixelBundle {
  const newSessionId = uuid();
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
    const combined = new Uint8Array(chunks.reduce((sum, c) => sum + c.length, 0));
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }
    json = new TextDecoder().decode(combined);
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd underpixel && pnpm --filter extension test -- --run src/replay/lib/import.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add extension/src/replay/lib/import.ts extension/src/replay/lib/import.test.ts
git commit -m "feat: add session import logic with validateBundle, rekeyBundle, and importSession"
```

---

### Task 4: Export modal component

**Files:**

- Create: `extension/src/replay/components/ExportModal.svelte`

- [ ] **Step 1: Create ExportModal component**

Create `extension/src/replay/components/ExportModal.svelte`:

```svelte
<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { DEFAULT_MASKED_HEADERS } from '../lib/export';
  import type { ExportOptions } from 'underpixel-shared';

  const dispatch = createEventDispatcher<{
    confirm: ExportOptions;
    cancel: void;
  }>();

  let includeScreenshots = true;
  let includeResponseBodies = true;
  let maskSensitiveHeaders = false;
  let maskedHeaderNames = DEFAULT_MASKED_HEADERS.join(', ');

  function handleConfirm() {
    const options: ExportOptions = {
      includeScreenshots,
      includeResponseBodies,
      maskSensitiveHeaders,
      maskedHeaderNames: maskedHeaderNames
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    };
    dispatch('confirm', options);
  }

  function handleCancel() {
    dispatch('cancel');
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      handleCancel();
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') handleCancel();
  }
</script>

<svelte:window on:keydown={handleKeydown} />

<!-- svelte-ignore a11y-click-events-have-key-events -->
<div class="modal-backdrop" on:click={handleBackdropClick} role="dialog" aria-modal="true">
  <div class="modal pixel-border">
    <h2 class="modal-title">EXPORT SESSION</h2>

    <div class="option-group">
      <label class="option">
        <input type="checkbox" bind:checked={includeScreenshots} />
        <span>Include screenshots</span>
      </label>

      <label class="option">
        <input type="checkbox" bind:checked={includeResponseBodies} />
        <span>Include response bodies</span>
      </label>

      <label class="option">
        <input type="checkbox" bind:checked={maskSensitiveHeaders} />
        <span>Mask sensitive headers</span>
      </label>

      {#if maskSensitiveHeaders}
        <div class="header-list">
          <label class="header-label">Headers to mask:</label>
          <input
            type="text"
            bind:value={maskedHeaderNames}
            placeholder="authorization, cookie, ..."
          />
        </div>
      {/if}
    </div>

    <div class="modal-actions">
      <button class="cancel-btn" on:click={handleCancel}>Cancel</button>
      <button class="confirm-btn" on:click={handleConfirm}>Export</button>
    </div>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .modal {
    background: var(--surface);
    border: var(--border-width) solid var(--border);
    padding: 20px;
    min-width: 340px;
    max-width: 420px;
  }

  .modal-title {
    font-family: var(--font-pixel);
    font-size: 9px;
    color: var(--accent);
    margin-bottom: 16px;
    text-shadow: 1px 1px 0 #5a1a1a;
  }

  .option-group {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-bottom: 20px;
  }

  .option {
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: var(--font-ui);
    font-size: 10px;
    color: var(--text-secondary);
    cursor: pointer;
  }

  .option input[type='checkbox'] {
    accent-color: var(--accent);
    width: 14px;
    height: 14px;
    cursor: pointer;
  }

  .header-list {
    margin-left: 22px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .header-label {
    font-family: var(--font-ui);
    font-size: 9px;
    color: var(--text-dim);
  }

  .header-list input[type='text'] {
    width: 100%;
  }

  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .cancel-btn {
    color: var(--text-dim);
  }

  .confirm-btn {
    color: var(--accent);
    border-color: var(--accent);
  }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add extension/src/replay/components/ExportModal.svelte
git commit -m "feat: add ExportModal component with screenshot/body/header masking options"
```

---

### Task 5: Wire export and import into replay UI

**Files:**

- Modify: `extension/entrypoints/replay/App.svelte`

- [ ] **Step 1: Add export/import logic and Import button to App.svelte**

In `extension/entrypoints/replay/App.svelte`, update the `<script>` block. Add imports at the top (after existing imports):

```typescript
import ExportModal from '../../src/replay/components/ExportModal.svelte';
import { exportSession } from '../../src/replay/lib/export';
import { importSession } from '../../src/replay/lib/import';
import type { ExportOptions } from 'underpixel-shared';
```

Add state variables after `let totalDuration = 0;`:

```typescript
let showExportModal = false;
let exporting = false;
let toastMessage = '';
let toastType: 'error' | 'success' = 'error';
let toastTimeout: ReturnType<typeof setTimeout>;

function showToast(message: string, type: 'error' | 'success' = 'error') {
  toastMessage = message;
  toastType = type;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toastMessage = '';
  }, 5000);
}

function handleExportClick() {
  if ($replayStore.session) {
    showExportModal = true;
  }
}

async function handleExportConfirm(e: CustomEvent<ExportOptions>) {
  showExportModal = false;
  const session = $replayStore.session;
  if (!session) return;

  exporting = true;
  try {
    await exportSession(session.id, e.detail);
    showToast('Session exported', 'success');
  } catch (err) {
    showToast(err instanceof Error ? err.message : 'Export failed');
  } finally {
    exporting = false;
  }
}

async function handleImportClick() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.underpixel';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;

    try {
      const newSessionId = await importSession(file);
      await loadSessions();
      await loadSession(newSessionId);
      const url = new URL(window.location.href);
      url.searchParams.set('sessionId', newSessionId);
      history.replaceState(null, '', url.toString());
      showToast('Session imported', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Import failed');
    }
  };
  input.click();
}
```

Replace the header section in the template. Find:

```svelte
    <header class="top-bar">
      <span class="logo">UNDERPIXEL</span>
      <SessionPicker on:select={handleSessionSelect} />
      <button class="export-btn">Export</button>
    </header>
```

Replace with:

```svelte
    <header class="top-bar">
      <span class="logo">UNDERPIXEL</span>
      <SessionPicker on:select={handleSessionSelect} />
      <div class="header-actions">
        <button class="import-btn" on:click={handleImportClick}>Import</button>
        <button
          class="export-btn"
          on:click={handleExportClick}
          disabled={!$replayStore.session || exporting}
        >
          {exporting ? 'Exporting...' : 'Export'}
        </button>
      </div>
    </header>

    {#if showExportModal}
      <ExportModal
        on:confirm={handleExportConfirm}
        on:cancel={() => (showExportModal = false)}
      />
    {/if}

    {#if toastMessage}
      <div class="toast toast-{toastType}">{toastMessage}</div>
    {/if}
```

Add styles inside the `<style>` block (after the existing `.export-btn` rule):

```css
.header-actions {
  display: flex;
  gap: 6px;
}

.import-btn {
  color: var(--text-secondary);
}

.export-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.toast {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  font-family: var(--font-ui);
  font-size: 10px;
  padding: 8px 16px;
  border: var(--border-width) solid var(--border);
  z-index: 2000;
  animation: toast-in 0.2s ease-out;
}

.toast-error {
  background: #3a1520;
  color: var(--error);
  border-color: var(--error);
}

.toast-success {
  background: #152a15;
  color: var(--success);
  border-color: var(--success);
}

@keyframes toast-in {
  from {
    opacity: 0;
    transform: translateX(-50%) translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add extension/entrypoints/replay/App.svelte
git commit -m "feat: wire export modal and import file picker into replay UI with toast notifications"
```

---

### Task 6: Imported session badge in SessionPicker

**Files:**

- Modify: `extension/src/replay/components/SessionPicker.svelte`

- [ ] **Step 1: Add imported badge to session options**

In `extension/src/replay/components/SessionPicker.svelte`, update the `{#each}` block. Find:

```svelte
      {#each $sessions as session}
        <option value={session.id}>
          ♦ {hostnameFromUrl(session.initialUrl)} ({formatSessionDuration(session.startTime, session.endTime)}) —
          {formatDate(session.startTime)}
        </option>
      {/each}
```

Replace with:

```svelte
      {#each $sessions as session}
        <option value={session.id}>
          {session.imported ? '▸' : '♦'} {hostnameFromUrl(session.initialUrl)} ({formatSessionDuration(session.startTime, session.endTime)}) —
          {formatDate(session.startTime)}{session.imported ? ' [Imported]' : ''}
        </option>
      {/each}
```

- [ ] **Step 2: Commit**

```bash
git add extension/src/replay/components/SessionPicker.svelte
git commit -m "feat: show Imported badge on imported sessions in SessionPicker"
```

---

### Task 7: Build and lint

**Files:** None (validation only)

- [ ] **Step 1: Run full build**

Run: `cd underpixel && pnpm build`
Expected: Clean build across all packages.

- [ ] **Step 2: Run linter**

Run: `cd underpixel && pnpm lint`
Expected: No new errors. Fix any issues found.

- [ ] **Step 3: Run all tests**

Run: `cd underpixel && pnpm test`
Expected: All tests pass, including new export and import tests.

- [ ] **Step 4: Commit any lint/build fixes**

If any fixes were needed:

```bash
git add -A
git commit -m "fix: address lint and build issues from export/import implementation"
```
