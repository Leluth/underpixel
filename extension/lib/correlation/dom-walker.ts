import type { StoredRrwebEvent } from 'underpixel-shared';

// ---- Types ----

type StoredRrwebEventWithId = StoredRrwebEvent & { id: number };

/** Minimal shape of an rrweb serialized node (Element=2, Text=3, Document=0) */
interface SNode {
  id: number;
  type: number;
  tagName?: string;
  attributes?: Record<string, string | number | boolean>;
  textContent?: string;
  childNodes?: SNode[];
}

type ParsedQuery =
  | { kind: 'id'; value: string }
  | { kind: 'class'; value: string }
  | { kind: 'attribute'; attr: string; value: string | undefined }
  | { kind: 'text'; words: string[] };

export interface DomMatch {
  nodeId: number;
  tagName: string;
  matchedBy: 'id' | 'class' | 'attribute' | 'text';
  rrwebEventId: number;
  eventKind: 'snapshot' | 'mutation-add';
  timestamp: number;
}

// ---- Constants ----

const MAX_MUTATION_ADDS = 2000;
const MAX_MATCHES = 50;

// ---- Query Parser ----

const ATTR_RE = /^\[([a-zA-Z_][\w:.-]*)(?:="([^"]*)")?\]$/;

function parseQuery(query: string): ParsedQuery | null {
  const q = query.trim();
  if (!q) return null;

  if (q.startsWith('#') && q.length > 1) {
    // HTML IDs are case-sensitive — preserve original case
    return { kind: 'id', value: q.slice(1) };
  }
  if (q.startsWith('.') && q.length > 1) {
    return { kind: 'class', value: q.slice(1).toLowerCase() };
  }
  const attrMatch = ATTR_RE.exec(q);
  if (attrMatch) {
    return {
      kind: 'attribute',
      attr: attrMatch[1].toLowerCase(),
      value: attrMatch[2]?.toLowerCase(),
    };
  }
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  return { kind: 'text', words };
}

// ---- Text Pre-computation ----

/**
 * Single bottom-up pass to collect text for every element node.
 * Returns a Map<nodeId, aggregatedText> so matchNode does O(1) lookup
 * instead of re-traversing the subtree per element.
 */
function buildTextMap(node: unknown, out: Map<number, string>): string {
  if (typeof node !== 'object' || node === null) return '';
  const sn = node as SNode;
  if (sn.type === 3) return sn.textContent ?? '';
  const parts: string[] = [];
  for (const child of sn.childNodes ?? []) {
    const t = buildTextMap(child, out);
    if (t) parts.push(t);
  }
  const text = parts.join(' ');
  if (sn.type === 2) out.set(sn.id, text);
  return text;
}

// ---- Node Matching ----

function matchNode(
  node: SNode,
  pq: ParsedQuery,
  textMap: Map<number, string> | null,
): DomMatch['matchedBy'] | null {
  if (node.type !== 2) return null;
  const attrs = node.attributes ?? {};

  switch (pq.kind) {
    case 'id':
      if (String(attrs.id ?? '') === pq.value) return 'id';
      break;
    case 'class': {
      const classes = String(attrs.class ?? '').toLowerCase().split(/\s+/);
      if (classes.includes(pq.value)) return 'class';
      break;
    }
    case 'attribute':
      if (pq.attr in attrs) {
        if (pq.value === undefined) return 'attribute';
        if (String(attrs[pq.attr]).toLowerCase() === pq.value) return 'attribute';
      }
      break;
    case 'text': {
      const searchable = [
        String(attrs.id ?? ''),
        String(attrs.class ?? ''),
        String(attrs['aria-label'] ?? ''),
        node.tagName ?? '',
        textMap?.get(node.id) ?? '',
      ].join(' ').toLowerCase();
      if (pq.words.every((w) => searchable.includes(w))) return 'text';
      break;
    }
  }
  return null;
}

// ---- Tree Walker ----

function walkTree(
  node: unknown,
  pq: ParsedQuery,
  textMap: Map<number, string> | null,
  results: DomMatch[],
  eventId: number,
  timestamp: number,
  eventKind: DomMatch['eventKind'],
): void {
  if (results.length >= MAX_MATCHES) return;
  if (typeof node !== 'object' || node === null) return;

  const sn = node as SNode;

  if (sn.type === 2) {
    const matchedBy = matchNode(sn, pq, textMap);
    if (matchedBy) {
      results.push({
        nodeId: sn.id,
        tagName: sn.tagName ?? 'unknown',
        matchedBy,
        rrwebEventId: eventId,
        eventKind,
        timestamp,
      });
    }
  }

  // Recurse: Document (0) and Element (2) have childNodes
  if (sn.type === 0 || sn.type === 2) {
    for (const child of sn.childNodes ?? []) {
      if (results.length >= MAX_MATCHES) return;
      walkTree(child, pq, textMap, results, eventId, timestamp, eventKind);
    }
  }
}

/** Build text map only when needed (text queries), then walk the tree */
function searchTree(
  root: unknown,
  pq: ParsedQuery,
  results: DomMatch[],
  eventId: number,
  timestamp: number,
  eventKind: DomMatch['eventKind'],
): void {
  let textMap: Map<number, string> | null = null;
  if (pq.kind === 'text') {
    textMap = new Map();
    buildTextMap(root, textMap);
  }
  walkTree(root, pq, textMap, results, eventId, timestamp, eventKind);
}

// ---- Public API ----

/**
 * Search stored rrweb events for DOM elements matching a query.
 * Walks full snapshots (EventType=2) and incremental mutation adds (EventType=3, source=0).
 * Returns empty array for invalid/empty queries.
 */
export function findDomElements(
  query: string,
  events: StoredRrwebEvent[],
): DomMatch[] {
  const pq = parseQuery(query);
  if (!pq) return [];

  const results: DomMatch[] = [];
  let addCount = 0;

  for (const event of events) {
    if (results.length >= MAX_MATCHES) break;
    const eventId = (event as StoredRrwebEventWithId).id ?? 0;

    if (event.type === 2) {
      const data = event.data as { node?: unknown };
      if (data?.node) {
        searchTree(data.node, pq, results, eventId, event.timestamp, 'snapshot');
      }
    } else if (event.type === 3) {
      const data = event.data as { source?: number; adds?: Array<{ node?: unknown }> };
      if (data?.source !== 0) continue;

      for (const add of data.adds ?? []) {
        if (addCount >= MAX_MUTATION_ADDS) break;
        if (results.length >= MAX_MATCHES) break;
        addCount++;
        if (add.node) {
          searchTree(add.node, pq, results, eventId, event.timestamp, 'mutation-add');
        }
      }
      if (addCount >= MAX_MUTATION_ADDS) break;
    }
  }

  return results;
}
