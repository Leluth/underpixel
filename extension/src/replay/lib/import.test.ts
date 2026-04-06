import { describe, it, expect } from 'vitest';
import { validateBundle, rekeyBundle } from './import';
import type { UnderpixelBundle, CaptureSession } from 'underpixel-shared';

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

  it('rejects non-array screenshots', () => {
    const bundle = makeValidBundle();
    (bundle as any).screenshots = 'not-an-array';
    expect(() => validateBundle(bundle)).toThrow('valid .underpixel export');
  });

  it('rejects non-array correlationBundles', () => {
    const bundle = makeValidBundle();
    (bundle as any).correlationBundles = {};
    expect(() => validateBundle(bundle)).toThrow('valid .underpixel export');
  });

  it('rejects null input', () => {
    expect(() => validateBundle(null)).toThrow('valid .underpixel export');
  });

  it('rejects string input', () => {
    expect(() => validateBundle('not a bundle')).toThrow('valid .underpixel export');
  });

  it('rejects number input', () => {
    expect(() => validateBundle(42)).toThrow('valid .underpixel export');
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

  it('handles empty arrays', () => {
    const bundle = makeValidBundle({
      networkRequests: [],
      rrwebEvents: [],
      screenshots: [],
      correlationBundles: [],
    } as Partial<UnderpixelBundle>);
    const rekeyed = rekeyBundle(bundle);

    expect(rekeyed.networkRequests).toHaveLength(0);
    expect(rekeyed.rrwebEvents).toHaveLength(0);
    expect(rekeyed.screenshots).toHaveLength(0);
    expect(rekeyed.correlationBundles).toHaveLength(0);
    expect(rekeyed.session.imported).toBe(true);
  });

  it('produces different session IDs on repeated calls', () => {
    const bundle = makeValidBundle();
    const first = rekeyBundle(bundle);
    const second = rekeyBundle(bundle);
    expect(first.session.id).not.toBe(second.session.id);
  });

  it('does not mutate original bundle', () => {
    const bundle = makeValidBundle();
    rekeyBundle(bundle);
    expect(bundle.session.id).toBe('orig-sess');
    expect(bundle.networkRequests[0].sessionId).toBe('orig-sess');
  });
});
