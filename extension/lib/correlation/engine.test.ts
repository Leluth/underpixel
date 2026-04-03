import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock IndexedDB before importing the engine
const mockDb = {
  get: vi.fn(),
  put: vi.fn(),
  getAllFromIndex: vi.fn(),
};

vi.mock('../storage/db', () => ({
  db: vi.fn(() => Promise.resolve(mockDb)),
}));

import { correlationEngine } from './engine';
import type { StoredRrwebEvent } from 'underpixel-shared';

/** Helper: build a full session mock with stats */
function mockSession(id: string, correlationWindow = 500) {
  return {
    id,
    config: { correlationWindow },
    stats: {
      networkRequestCount: 1,
      rrwebEventCount: 0,
      screenshotCount: 0,
      correlationBundleCount: 0,
    },
  };
}

const TEST_API_INFO = { method: 'GET', url: 'https://api.example.com/users' };
const REQRES_API_INFO = { method: 'GET', url: 'https://reqres.in/api/users' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  // Clear internal state for all sessions used in tests
  correlationEngine.clearSession('test-session');
  correlationEngine.clearSession('session-a');
  correlationEngine.clearSession('session-b');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('CorrelationEngine', () => {
  describe('onDomMutation', () => {
    it('tracks IncrementalSnapshot mutation events (type=3, source=0)', () => {
      const event: StoredRrwebEvent = {
        sessionId: 'test-session',
        timestamp: 1000,
        type: 3,
        data: {
          source: 0,
          adds: [{ node: {} }],
          removes: [],
          texts: [{ id: 1, value: 'hello' }],
          attributes: [],
        },
      };

      // Should not throw
      correlationEngine.onDomMutation('test-session', event);
    });

    it('ignores non-IncrementalSnapshot events (type !== 3)', () => {
      const event: StoredRrwebEvent = {
        sessionId: 'test-session',
        timestamp: 1000,
        type: 2, // FullSnapshot
        data: { node: {} },
      };

      // Should be silently ignored (no error)
      correlationEngine.onDomMutation('test-session', event);
    });

    it('ignores non-mutation IncrementalSnapshot events (source !== 0)', () => {
      const event: StoredRrwebEvent = {
        sessionId: 'test-session',
        timestamp: 1000,
        type: 3,
        data: { source: 1 }, // MouseMove, not Mutation
      };

      correlationEngine.onDomMutation('test-session', event);
    });
  });

  describe('onApiResponse + buildBundle', () => {
    it('builds correlation bundle when mutations exist in the window', async () => {
      mockDb.get.mockImplementation((store: string) => {
        if (store === 'sessions') return Promise.resolve(mockSession('test-session'));
        return Promise.resolve(undefined);
      });
      mockDb.put.mockResolvedValue(undefined);

      // 1. Register a mutation at T=1000
      correlationEngine.onDomMutation('test-session', {
        sessionId: 'test-session',
        timestamp: 1000,
        type: 3,
        data: {
          source: 0,
          adds: [{ node: {} }, { node: {} }],
          removes: [],
          texts: [{ id: 1, value: 'User 1' }],
          attributes: [],
        },
      });

      // 2. API response at T=900 (mutation is within 500ms window: 900–1400)
      correlationEngine.onApiResponse('test-session', 'req-1', 900, TEST_API_INFO);

      // 3. Advance timer past correlation window
      await vi.advanceTimersByTimeAsync(600);

      // 4. Should have written a correlation bundle
      const bundlePuts = mockDb.put.mock.calls.filter(
        ([store]: [string]) => store === 'correlationBundles',
      );
      expect(bundlePuts.length).toBe(1);

      const bundle = bundlePuts[0][1];
      expect(bundle.sessionId).toBe('test-session');
      expect(bundle.apiCalls).toEqual(['req-1']);
      expect(bundle.domMutationSummary).toMatchObject({
        addedNodes: 2,
        removedNodes: 0,
        textChanges: 1,
        attributeChanges: 0,
      });
      expect(bundle.trigger).toContain('GET');
      expect(bundle.trigger).toContain('/users');
    });

    it('uses request info passed via onApiResponse (no IDB re-read)', async () => {
      // Only mock sessions — no networkRequests mock needed
      mockDb.get.mockImplementation((store: string) => {
        if (store === 'sessions') return Promise.resolve(mockSession('test-session'));
        return Promise.resolve(undefined);
      });
      mockDb.put.mockResolvedValue(undefined);

      correlationEngine.onDomMutation('test-session', {
        sessionId: 'test-session',
        timestamp: 1000,
        type: 3,
        data: { source: 0, adds: [{ node: {} }], removes: [], texts: [], attributes: [] },
      });

      correlationEngine.onApiResponse('test-session', 'req-1', 900, {
        method: 'POST',
        url: 'https://api.example.com/data',
      });

      await vi.advanceTimersByTimeAsync(600);

      const bundlePuts = mockDb.put.mock.calls.filter(
        ([store]: [string]) => store === 'correlationBundles',
      );
      expect(bundlePuts.length).toBe(1);
      expect(bundlePuts[0][1].trigger).toBe('POST /data');

      // Should NOT have tried to read networkRequests from IDB
      const nrReads = mockDb.get.mock.calls.filter(
        ([store]: [string]) => store === 'networkRequests',
      );
      expect(nrReads.length).toBe(0);
    });

    it('builds bundle when mutation timestamp is slightly before apiTime (CDP latency)', async () => {
      mockDb.get.mockImplementation((store: string) => {
        if (store === 'sessions') return Promise.resolve(mockSession('test-session'));
        return Promise.resolve(undefined);
      });
      mockDb.put.mockResolvedValue(undefined);

      // DOM mutation at T=995 — page JS processed the response before
      // CDP delivered Network.loadingFinished to the background
      correlationEngine.onDomMutation('test-session', {
        sessionId: 'test-session',
        timestamp: 995,
        type: 3,
        data: {
          source: 0,
          adds: [{ node: {} }, { node: {} }, { node: {} }],
          removes: [],
          texts: [],
          attributes: [],
        },
      });

      // API response at T=1000 (mutation is 5ms BEFORE apiTime)
      correlationEngine.onApiResponse('test-session', 'req-1', 1000, REQRES_API_INFO);

      await vi.advanceTimersByTimeAsync(600);

      const bundlePuts = mockDb.put.mock.calls.filter(
        ([store]: [string]) => store === 'correlationBundles',
      );
      expect(bundlePuts.length).toBe(1);
      expect(bundlePuts[0][1].domMutationSummary.addedNodes).toBe(3);
    });

    it('does NOT build bundle when no mutations in the window', async () => {
      mockDb.get.mockImplementation((store: string) => {
        if (store === 'sessions') return Promise.resolve(mockSession('test-session'));
        return Promise.resolve(undefined);
      });
      mockDb.put.mockResolvedValue(undefined);

      // API response at T=5000 but mutations are at T=1000 (way outside window)
      correlationEngine.onDomMutation('test-session', {
        sessionId: 'test-session',
        timestamp: 1000,
        type: 3,
        data: { source: 0, adds: [{ node: {} }] },
      });

      correlationEngine.onApiResponse('test-session', 'req-1', 5000, TEST_API_INFO);
      await vi.advanceTimersByTimeAsync(600);

      const bundlePuts = mockDb.put.mock.calls.filter(
        ([store]: [string]) => store === 'correlationBundles',
      );
      expect(bundlePuts.length).toBe(0);
    });

    it('does not write session stats to IDB per bundle (batched to session end)', async () => {
      mockDb.get.mockImplementation((store: string) => {
        if (store === 'sessions') return Promise.resolve(mockSession('test-session'));
        return Promise.resolve(undefined);
      });
      mockDb.put.mockResolvedValue(undefined);

      correlationEngine.onDomMutation('test-session', {
        sessionId: 'test-session',
        timestamp: 1000,
        type: 3,
        data: { source: 0, adds: [{ node: {} }], removes: [], texts: [], attributes: [] },
      });

      correlationEngine.onApiResponse('test-session', 'req-1', 900, TEST_API_INFO);
      await vi.advanceTimersByTimeAsync(600);

      // Should have written the bundle but NOT read/written session stats
      const sessionPuts = mockDb.put.mock.calls.filter(([store]: [string]) => store === 'sessions');
      expect(sessionPuts.length).toBe(0);

      // In-memory count should be tracked
      expect(correlationEngine.getBundleCount('test-session')).toBe(1);
    });

    it('caches correlation window per session (single IDB read)', async () => {
      mockDb.get.mockImplementation((store: string) => {
        if (store === 'sessions') return Promise.resolve(mockSession('test-session'));
        return Promise.resolve(undefined);
      });
      mockDb.put.mockResolvedValue(undefined);

      // First API response — triggers IDB read for correlation window
      correlationEngine.onDomMutation('test-session', {
        sessionId: 'test-session',
        timestamp: 1000,
        type: 3,
        data: { source: 0, adds: [{ node: {} }], removes: [], texts: [], attributes: [] },
      });
      correlationEngine.onApiResponse('test-session', 'req-1', 900, TEST_API_INFO);
      await vi.advanceTimersByTimeAsync(600);

      const sessionReadsAfterFirst = mockDb.get.mock.calls.filter(
        ([store]: [string]) => store === 'sessions',
      ).length;

      // Second API response — should use cached window (no new session read)
      correlationEngine.onDomMutation('test-session', {
        sessionId: 'test-session',
        timestamp: 2000,
        type: 3,
        data: { source: 0, adds: [{ node: {} }], removes: [], texts: [], attributes: [] },
      });
      correlationEngine.onApiResponse('test-session', 'req-2', 1900, TEST_API_INFO);
      await vi.advanceTimersByTimeAsync(600);

      const sessionReadsAfterSecond = mockDb.get.mock.calls.filter(
        ([store]: [string]) => store === 'sessions',
      ).length;

      // No additional session reads for the second API response
      expect(sessionReadsAfterSecond).toBe(sessionReadsAfterFirst);
      expect(correlationEngine.getBundleCount('test-session')).toBe(2);
    });
  });

  describe('getBundleCount', () => {
    it('returns 0 for unknown sessions', () => {
      expect(correlationEngine.getBundleCount('nonexistent')).toBe(0);
    });
  });

  describe('clearSession', () => {
    it('clears mutations and pending timers for a session', () => {
      correlationEngine.onDomMutation('test-session', {
        sessionId: 'test-session',
        timestamp: 1000,
        type: 3,
        data: { source: 0, adds: [{ node: {} }] },
      });

      correlationEngine.clearSession('test-session');
      // Should not throw and internal state should be clean
      expect(correlationEngine.getBundleCount('test-session')).toBe(0);
    });

    it('cancels pending timers and prevents bundle writes', async () => {
      mockDb.get.mockImplementation((store: string) => {
        if (store === 'sessions') return Promise.resolve(mockSession('test-session'));
        return Promise.resolve(undefined);
      });
      mockDb.put.mockResolvedValue(undefined);

      // Register a mutation so a bundle would be created
      correlationEngine.onDomMutation('test-session', {
        sessionId: 'test-session',
        timestamp: 1000,
        type: 3,
        data: { source: 0, adds: [{ node: {} }], removes: [], texts: [], attributes: [] },
      });

      // Fire API response (schedules a bundle timer)
      correlationEngine.onApiResponse('test-session', 'req-pending', 900, TEST_API_INFO);

      // Clear before the window closes
      correlationEngine.clearSession('test-session');

      // Advance past the window — timer was cancelled, nothing should write
      await vi.advanceTimersByTimeAsync(600);

      const bundlePuts = mockDb.put.mock.calls.filter(
        ([store]: [string]) => store === 'correlationBundles',
      );
      expect(bundlePuts.length).toBe(0);
    });

    it('does not affect other sessions', () => {
      correlationEngine.onDomMutation('session-a', {
        sessionId: 'session-a',
        timestamp: 1000,
        type: 3,
        data: { source: 0, adds: [{ node: {} }] },
      });

      correlationEngine.onDomMutation('session-b', {
        sessionId: 'session-b',
        timestamp: 1000,
        type: 3,
        data: { source: 0, adds: [{ node: {} }] },
      });

      correlationEngine.clearSession('session-a');
      // session-b should still have its mutations — no way to observe directly
      // but clearing session-a should not throw or clear session-b
    });
  });
});
