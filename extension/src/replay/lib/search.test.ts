import { describe, it, expect } from 'vitest';
import { matchesFilters, matchesSearch } from './search';
import type { NetworkRequest } from 'underpixel-shared';

const makeRequest = (overrides: Partial<NetworkRequest>): NetworkRequest => ({
  requestId: '1',
  sessionId: 's1',
  url: 'https://api.example.com/api/okrs',
  method: 'GET',
  status: 'complete',
  statusCode: 200,
  type: 'XHR',
  startTime: 1000,
  ...overrides,
});

describe('matchesFilters', () => {
  it('passes when no filters active', () => {
    const req = makeRequest({});
    expect(matchesFilters(req, { methods: [], statusRanges: [] })).toBe(true);
  });
  it('filters by method', () => {
    const req = makeRequest({ method: 'POST' });
    expect(matchesFilters(req, { methods: ['GET'], statusRanges: [] })).toBe(false);
    expect(matchesFilters(req, { methods: ['POST'], statusRanges: [] })).toBe(true);
  });
  it('filters by status range', () => {
    const req = makeRequest({ statusCode: 500 });
    expect(matchesFilters(req, { methods: [], statusRanges: ['2xx'] })).toBe(false);
    expect(matchesFilters(req, { methods: [], statusRanges: ['5xx'] })).toBe(true);
  });
  it('combines method + status (AND)', () => {
    const req = makeRequest({ method: 'GET', statusCode: 200 });
    expect(matchesFilters(req, { methods: ['GET'], statusRanges: ['2xx'] })).toBe(true);
    expect(matchesFilters(req, { methods: ['POST'], statusRanges: ['2xx'] })).toBe(false);
  });
});

describe('matchesSearch', () => {
  it('matches URL', () => {
    const req = makeRequest({ url: 'https://api.example.com/api/okrs' });
    expect(matchesSearch(req, 'okrs')).toBe(true);
  });
  it('matches response body', () => {
    const req = makeRequest({ responseBody: '{"name":"Alice"}' });
    expect(matchesSearch(req, 'alice')).toBe(true);
  });
  it('matches request headers', () => {
    const req = makeRequest({
      requestHeaders: { authorization: 'Bearer xyz' },
    });
    expect(matchesSearch(req, 'bearer')).toBe(true);
  });
  it('is case-insensitive', () => {
    const req = makeRequest({ url: 'https://api.example.com/API/OKRs' });
    expect(matchesSearch(req, 'okrs')).toBe(true);
  });
  it('returns true for empty query', () => {
    expect(matchesSearch(makeRequest({}), '')).toBe(true);
  });
});
