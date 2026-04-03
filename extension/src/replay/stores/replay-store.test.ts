import { describe, it, expect } from 'vitest';
import { findActiveGroup, findCallsAtTime } from './replay-store';
import type { CorrelationBundle, NetworkRequest } from 'underpixel-shared';

const bundle = (id: string, timestamp: number, apiCalls: string[]): CorrelationBundle => ({
  id,
  sessionId: 's1',
  timestamp,
  trigger: 'fetch response: GET /api/test',
  apiCalls,
  rrwebEventIds: [],
  correlation: 'test',
});

const request = (id: string, start: number, end: number): NetworkRequest => ({
  requestId: id,
  sessionId: 's1',
  url: `https://api.example.com/api/${id}`,
  method: 'GET',
  status: 'complete',
  statusCode: 200,
  type: 'XHR',
  startTime: start,
  endTime: end,
});

describe('findActiveGroup', () => {
  const bundles = [
    bundle('b1', 1000, ['r1']),
    bundle('b2', 3000, ['r2', 'r3']),
    bundle('b3', 6000, ['r4']),
  ];

  it('returns the group containing the current time', () => {
    expect(findActiveGroup(bundles, 3200)).toBe(bundles[1]);
  });
  it('returns the nearest preceding group', () => {
    expect(findActiveGroup(bundles, 4500)).toBe(bundles[1]);
  });
  it('returns null before any groups', () => {
    expect(findActiveGroup(bundles, 500)).toBeNull();
  });
  it('returns last group after all groups', () => {
    expect(findActiveGroup(bundles, 9000)).toBe(bundles[2]);
  });
});

describe('findCallsAtTime', () => {
  const requests = [
    request('r1', 1000, 1200),
    request('r2', 1100, 1500),
    request('r3', 3000, 3100),
  ];

  it('returns calls whose time range contains currentTime', () => {
    const result = findCallsAtTime(requests, 1150);
    expect(result.map((r) => r.requestId)).toEqual(['r1', 'r2']);
  });
  it('returns empty array if no calls overlap', () => {
    expect(findCallsAtTime(requests, 2000)).toEqual([]);
  });
});
