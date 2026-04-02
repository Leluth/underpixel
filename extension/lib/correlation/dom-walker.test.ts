import { describe, it, expect } from 'vitest';
import { findDomElements, collectMatchedNodeValues } from './dom-walker';
import type { StoredRrwebEvent } from 'underpixel-shared';

// ---- Helpers to build rrweb-like snapshot structures ----

/** Create a text node */
function textNode(id: number, text: string) {
  return { id, type: 3, textContent: text };
}

/** Create an element node */
function elNode(
  id: number,
  tagName: string,
  attrs: Record<string, string | number | boolean> = {},
  children: unknown[] = [],
) {
  return { id, type: 2, tagName, attributes: attrs, childNodes: children };
}

/** Create a document node wrapping children */
function docNode(children: unknown[]) {
  return { id: 0, type: 0, childNodes: children };
}

/** Wrap a node tree as a full snapshot rrweb event (EventType=2) */
function fullSnapshot(node: unknown, timestamp = 1000): StoredRrwebEvent & { id: number } {
  return {
    id: 1,
    sessionId: 'test-session',
    timestamp,
    type: 2, // EventType.FullSnapshot
    data: { node },
  };
}

/** Wrap added nodes as an incremental mutation event (EventType=3, source=0) */
function mutationAdd(
  adds: Array<{ node: unknown }>,
  timestamp = 2000,
  eventId = 2,
): StoredRrwebEvent & { id: number } {
  return {
    id: eventId,
    sessionId: 'test-session',
    timestamp,
    type: 3, // EventType.IncrementalSnapshot
    data: { source: 0, adds },
  };
}

// ---- Sample DOM trees ----

const sampleTree = docNode([
  elNode(1, 'html', {}, [
    elNode(2, 'body', {}, [
      elNode(3, 'div', { id: 'user-table', class: 'data-grid primary' }, [
        elNode(4, 'span', { class: 'user-name' }, [textNode(5, 'Alice Smith')]),
        elNode(6, 'span', { class: 'user-name' }, [textNode(7, 'Bob Jones')]),
      ]),
      elNode(8, 'img', { src: 'https://cdn.example.com/photo.jpg', alt: 'Profile photo' }),
      elNode(9, 'a', { href: '/users/123' }, [textNode(10, 'View Profile')]),
      elNode(11, 'input', { placeholder: 'Search users...', 'data-testid': 'search-box' }),
    ]),
  ]),
]);

// ---- Tests ----

describe('findDomElements', () => {
  describe('query parsing', () => {
    it('returns empty for empty query', () => {
      const events = [fullSnapshot(sampleTree)];
      expect(findDomElements('', events)).toEqual([]);
    });

    it('returns empty for whitespace-only query', () => {
      const events = [fullSnapshot(sampleTree)];
      expect(findDomElements('   ', events)).toEqual([]);
    });

    it('returns empty for "#" alone', () => {
      const events = [fullSnapshot(sampleTree)];
      expect(findDomElements('#', events)).toEqual([]);
    });

    it('"." alone is treated as text search (not class query), may match elements', () => {
      const events = [fullSnapshot(sampleTree)];
      // "." alone is not a valid class query (needs >1 char), so it's treated
      // as text search for the literal "." character — may match elements
      // with "." in attribute values (e.g., URLs, domains)
      const results = findDomElements('.', events);
      // Not testing exact results, just that it doesn't crash
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe('ID queries (#id)', () => {
    it('finds element by ID', () => {
      const events = [fullSnapshot(sampleTree)];
      const results = findDomElements('#user-table', events);
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        nodeId: 3,
        tagName: 'div',
        matchedBy: 'id',
        eventKind: 'snapshot',
      });
    });

    it('returns empty for non-existent ID', () => {
      const events = [fullSnapshot(sampleTree)];
      expect(findDomElements('#nonexistent', events)).toEqual([]);
    });

    it('is case-sensitive for IDs', () => {
      const events = [fullSnapshot(sampleTree)];
      expect(findDomElements('#User-Table', events)).toEqual([]);
    });
  });

  describe('class queries (.class)', () => {
    it('finds elements by class name', () => {
      const events = [fullSnapshot(sampleTree)];
      const results = findDomElements('.user-name', events);
      expect(results).toHaveLength(2);
      expect(results[0].nodeId).toBe(4);
      expect(results[1].nodeId).toBe(6);
      expect(results[0].matchedBy).toBe('class');
    });

    it('matches class in multi-class attribute', () => {
      const events = [fullSnapshot(sampleTree)];
      const results = findDomElements('.data-grid', events);
      expect(results).toHaveLength(1);
      expect(results[0].nodeId).toBe(3);
    });

    it('matches class case-insensitively', () => {
      const events = [fullSnapshot(sampleTree)];
      const results = findDomElements('.User-Name', events);
      expect(results).toHaveLength(2);
    });
  });

  describe('attribute queries ([attr="val"])', () => {
    it('finds element by attribute with value', () => {
      const events = [fullSnapshot(sampleTree)];
      const results = findDomElements('[data-testid="search-box"]', events);
      expect(results).toHaveLength(1);
      expect(results[0].nodeId).toBe(11);
      expect(results[0].matchedBy).toBe('attribute');
    });

    it('finds element by attribute existence (no value)', () => {
      const events = [fullSnapshot(sampleTree)];
      const results = findDomElements('[placeholder]', events);
      expect(results).toHaveLength(1);
      expect(results[0].nodeId).toBe(11);
    });
  });

  describe('text queries (free text)', () => {
    it('finds elements by text content', () => {
      const events = [fullSnapshot(sampleTree)];
      const results = findDomElements('Alice', events);
      // Should match the span containing "Alice Smith" and possibly parent div
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.nodeId === 4)).toBe(true);
    });

    it('matches multi-word queries (all words must match)', () => {
      const events = [fullSnapshot(sampleTree)];
      const results = findDomElements('Alice Smith', events);
      expect(results.length).toBeGreaterThan(0);
      // "Alice" and "Smith" both appear in span#4's text
      expect(results.some((r) => r.nodeId === 4)).toBe(true);
    });

    it('matches against src attribute values', () => {
      const events = [fullSnapshot(sampleTree)];
      const results = findDomElements('cdn.example.com', events);
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.nodeId === 8)).toBe(true);
    });

    it('matches against href attribute values', () => {
      const events = [fullSnapshot(sampleTree)];
      const results = findDomElements('/users/123', events);
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.nodeId === 9)).toBe(true);
    });

    it('matches against placeholder attribute', () => {
      const events = [fullSnapshot(sampleTree)];
      const results = findDomElements('Search users', events);
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.nodeId === 11)).toBe(true);
    });

    it('matches against data-* attributes', () => {
      const events = [fullSnapshot(sampleTree)];
      const results = findDomElements('search-box', events);
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.nodeId === 11)).toBe(true);
    });

    it('is case-insensitive', () => {
      const events = [fullSnapshot(sampleTree)];
      const results = findDomElements('alice smith', events);
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('mutation-add events', () => {
    it('searches added nodes in mutation events', () => {
      const addedNode = elNode(20, 'div', { id: 'new-section' }, [textNode(21, 'New content')]);
      const events = [fullSnapshot(docNode([])), mutationAdd([{ node: addedNode }])];
      const results = findDomElements('#new-section', events);
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        nodeId: 20,
        tagName: 'div',
        matchedBy: 'id',
        eventKind: 'mutation-add',
      });
    });
  });

  describe('limits', () => {
    it('respects MAX_MATCHES (50) limit', () => {
      // Create a tree with 100 matching elements
      const children = Array.from({ length: 100 }, (_, i) =>
        elNode(i + 10, 'div', { class: 'item' }, [textNode(i + 1000, `Item ${i}`)]),
      );
      const tree = docNode([elNode(1, 'body', {}, children)]);
      const events = [fullSnapshot(tree)];
      const results = findDomElements('.item', events);
      expect(results).toHaveLength(50);
    });
  });

  describe('no events', () => {
    it('returns empty for no events', () => {
      expect(findDomElements('#anything', [])).toEqual([]);
    });

    it('skips non-snapshot/non-mutation events', () => {
      const mouseEvent: StoredRrwebEvent = {
        sessionId: 'test',
        timestamp: 1000,
        type: 3,
        data: { source: 1 }, // IncrementalSource.MouseMove
      };
      expect(findDomElements('#anything', [mouseEvent])).toEqual([]);
    });
  });
});

describe('collectMatchedNodeValues', () => {
  it('extracts text content from matched subtrees', () => {
    const events = [fullSnapshot(sampleTree)];
    const matches = findDomElements('.user-name', events);
    const values = collectMatchedNodeValues(events, matches);
    expect(values).toContain('Alice Smith');
    expect(values).toContain('Bob Jones');
  });

  it('extracts content attribute values (src, href, alt)', () => {
    const tree = docNode([
      elNode(1, 'body', {}, [
        elNode(2, 'img', { src: 'https://example.com/photo.png', alt: 'A nice photo' }),
      ]),
    ]);
    const events = [fullSnapshot(tree)];
    const matches = findDomElements('photo', events);
    const values = collectMatchedNodeValues(events, matches);
    expect(values).toContain('https://example.com/photo.png');
    expect(values).toContain('A nice photo');
  });

  it('excludes short values (< 4 chars)', () => {
    const tree = docNode([
      elNode(1, 'body', {}, [elNode(2, 'span', { class: 'test-item' }, [textNode(3, 'Hi')])]),
    ]);
    const events = [fullSnapshot(tree)];
    const matches = findDomElements('.test-item', events);
    const values = collectMatchedNodeValues(events, matches);
    expect(values).not.toContain('Hi');
  });

  it('returns empty for empty matches', () => {
    expect(collectMatchedNodeValues([], [])).toEqual([]);
  });

  it('extracts data-* attribute values', () => {
    const tree = docNode([
      elNode(1, 'body', {}, [elNode(2, 'div', { 'data-user-id': 'user-abc-123' })]),
    ]);
    const events = [fullSnapshot(tree)];
    const matches = findDomElements('[data-user-id]', events);
    const values = collectMatchedNodeValues(events, matches);
    expect(values).toContain('user-abc-123');
  });
});
