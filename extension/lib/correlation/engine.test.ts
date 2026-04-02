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
      // Setup: per-test mock that returns full session + network request
      mockDb.get.mockImplementation((store: string, _id: string) => {
        if (store === 'sessions') return Promise.resolve(mockSession('test-session'));
        if (store === 'networkRequests') {
          return Promise.resolve({
            requestId: 'req-1',
            sessionId: 'test-session',
            url: 'https://api.example.com/users',
            method: 'GET',
          });
        }
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
      correlationEngine.onApiResponse('test-session', 'req-1', 900);

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

    it('does NOT build bundle when no mutations in the window', async () => {
      // Separate mock: only sessions needed (bundle won't be built)
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

      correlationEngine.onApiResponse('test-session', 'req-1', 5000);
      await vi.advanceTimersByTimeAsync(600);

      const bundlePuts = mockDb.put.mock.calls.filter(
        ([store]: [string]) => store === 'correlationBundles',
      );
      expect(bundlePuts.length).toBe(0);
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
