import { describe, it, expect } from 'vitest';
import { findCallsAtTime, findActiveEvent } from './replay-store';
import type { NetworkRequest } from 'underpixel-shared';
import type { EventSection } from '../lib/event-sections';

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

const eventSection = (id: string, timestamp: number): EventSection => ({
  id,
  timestamp,
  type: 'click',
  label: 'CLICK',
  target: null,
  bundles: [],
  correlatedRequests: [],
  backgroundRequests: [],
  domSummary: { addedNodes: 0, removedNodes: 0, textChanges: 0, attributeChanges: 0 },
});

describe('findActiveEvent', () => {
  const sections = [eventSection('e1', 1000), eventSection('e2', 3000), eventSection('e3', 6000)];

  it('returns the section containing the current time', () => {
    expect(findActiveEvent(sections, 3200)).toBe(sections[1]);
  });
  it('returns null before any sections', () => {
    expect(findActiveEvent(sections, 500)).toBeNull();
  });
  it('returns last section after all sections', () => {
    expect(findActiveEvent(sections, 9000)).toBe(sections[2]);
  });
});
