import { describe, it, expect } from 'vitest';
import { buildEventSections } from './event-sections';
import type { StoredRrwebEvent, CorrelationBundle, NetworkRequest } from 'underpixel-shared';

function rrwebInteraction(
  timestamp: number,
  source: number,
  interactionType?: number,
): StoredRrwebEvent {
  return {
    sessionId: 's1',
    timestamp,
    type: 3,
    data: { source, type: interactionType },
  };
}

function bundle(
  id: string,
  timestamp: number,
  apiCalls: string[],
  summary?: Partial<{
    addedNodes: number;
    removedNodes: number;
    textChanges: number;
    attributeChanges: number;
  }>,
): CorrelationBundle {
  return {
    id,
    sessionId: 's1',
    timestamp,
    trigger: `GET /api/${id}`,
    apiCalls,
    rrwebEventIds: [],
    correlation: 'test',
    domMutationSummary: {
      addedNodes: summary?.addedNodes ?? 5,
      removedNodes: summary?.removedNodes ?? 0,
      textChanges: summary?.textChanges ?? 1,
      attributeChanges: summary?.attributeChanges ?? 0,
    },
  };
}

function request(id: string, startTime: number): NetworkRequest {
  return {
    requestId: id,
    sessionId: 's1',
    url: `https://api.example.com/${id}`,
    method: 'GET',
    status: 'complete',
    statusCode: 200,
    type: 'XHR',
    startTime,
    endTime: startTime + 100,
  };
}

describe('buildEventSections', () => {
  it('groups bundles under preceding click interaction', () => {
    const events = [rrwebInteraction(1000, 2, 2)];
    const bundles = [bundle('b1', 1500, ['r1'])];
    const requests = [request('r1', 1400)];
    const sections = buildEventSections(events, bundles, requests);
    expect(sections).toHaveLength(1);
    expect(sections[0].type).toBe('click');
    expect(sections[0].bundles).toHaveLength(1);
    expect(sections[0].bundles[0].id).toBe('b1');
  });

  it('creates page-update event when no preceding interaction', () => {
    const events: StoredRrwebEvent[] = [];
    const bundles = [bundle('b1', 1000, ['r1'])];
    const requests = [request('r1', 900)];
    const sections = buildEventSections(events, bundles, requests);
    expect(sections).toHaveLength(1);
    expect(sections[0].type).toBe('page-update');
    expect(sections[0].label).toBe('PAGE UPDATE');
  });

  it('attaches background requests to nearest preceding event', () => {
    const events = [rrwebInteraction(1000, 2, 2)];
    const bundles = [bundle('b1', 1500, ['r1'])];
    const requests = [request('r1', 1400), request('r2', 1600)];
    const sections = buildEventSections(events, bundles, requests);
    expect(sections).toHaveLength(1);
    expect(sections[0].backgroundRequests).toHaveLength(1);
    expect(sections[0].backgroundRequests[0].requestId).toBe('r2');
  });

  it('attaches pre-first-event background requests to first event', () => {
    const events = [rrwebInteraction(5000, 2, 2)];
    const bundles = [bundle('b1', 5500, ['r2'])];
    const requests = [request('r1', 1000), request('r2', 5400)];
    const sections = buildEventSections(events, bundles, requests);
    expect(sections).toHaveLength(1);
    expect(sections[0].backgroundRequests).toHaveLength(1);
    expect(sections[0].backgroundRequests[0].requestId).toBe('r1');
  });

  it('deduplicates rapid interactions of same type within 200ms', () => {
    const events = [rrwebInteraction(1000, 2, 2), rrwebInteraction(1100, 2, 2)];
    const bundles = [bundle('b1', 1500, ['r1'])];
    const requests = [request('r1', 1400)];
    const sections = buildEventSections(events, bundles, requests);
    expect(sections).toHaveLength(1);
    expect(sections[0].timestamp).toBe(1000);
  });

  it('keeps different interaction types within 200ms as separate events', () => {
    const events = [rrwebInteraction(1000, 2, 2), rrwebInteraction(1100, 5)];
    const bundles = [bundle('b1', 1400, ['r1']), bundle('b2', 1500, ['r2'])];
    const requests = [request('r1', 1300), request('r2', 1450)];
    const sections = buildEventSections(events, bundles, requests);
    expect(sections).toHaveLength(2);
    expect(sections[0].type).toBe('click');
    expect(sections[1].type).toBe('input');
  });

  it('merges adjacent page-update bundles within 1 second', () => {
    const events: StoredRrwebEvent[] = [];
    const bundles = [bundle('b1', 1000, ['r1']), bundle('b2', 1500, ['r2'])];
    const requests = [request('r1', 900), request('r2', 1400)];
    const sections = buildEventSections(events, bundles, requests);
    expect(sections).toHaveLength(1);
    expect(sections[0].type).toBe('page-update');
    expect(sections[0].bundles).toHaveLength(2);
  });

  it('aggregates domSummary across bundles in a section', () => {
    const events = [rrwebInteraction(1000, 2, 2)];
    const bundles = [
      bundle('b1', 1500, ['r1'], { addedNodes: 10, textChanges: 2 }),
      bundle('b2', 1800, ['r2'], { addedNodes: 5, textChanges: 3 }),
    ];
    const requests = [request('r1', 1400), request('r2', 1700)];
    const sections = buildEventSections(events, bundles, requests);
    expect(sections[0].domSummary).toEqual({
      addedNodes: 15,
      removedNodes: 0,
      textChanges: 5,
      attributeChanges: 0,
    });
  });

  it('omits interaction events with no following bundles or requests', () => {
    const events = [rrwebInteraction(1000, 2, 2), rrwebInteraction(5000, 2, 2)];
    const bundles = [bundle('b1', 5500, ['r1'])];
    const requests = [request('r1', 5400)];
    const sections = buildEventSections(events, bundles, requests);
    expect(sections).toHaveLength(1);
    expect(sections[0].timestamp).toBe(5000);
  });

  it('sorts event sections chronologically', () => {
    const events = [rrwebInteraction(5000, 2, 2), rrwebInteraction(1000, 5)];
    const bundles = [bundle('b1', 5500, ['r1']), bundle('b2', 1500, ['r2'])];
    const requests = [request('r1', 5400), request('r2', 1400)];
    const sections = buildEventSections(events, bundles, requests);
    expect(sections[0].timestamp).toBeLessThan(sections[1].timestamp);
  });

  it('returns empty array when no bundles and no requests', () => {
    expect(buildEventSections([], [], [])).toEqual([]);
  });
});
