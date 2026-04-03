import type { StoredRrwebEvent, CorrelationBundle, NetworkRequest } from 'underpixel-shared';

export interface EventSection {
  id: string;
  timestamp: number;
  type: 'click' | 'input' | 'scroll' | 'page-update';
  label: string;
  target: string | null;
  bundles: CorrelationBundle[];
  correlatedRequests: NetworkRequest[]; // pre-resolved from bundle apiCalls
  backgroundRequests: NetworkRequest[];
  domSummary: {
    addedNodes: number;
    removedNodes: number;
    textChanges: number;
    attributeChanges: number;
  };
}

const MOUSE_INTERACTION = 2;
const INPUT = 5;
const SCROLL = 3;
const CLICK_TYPES = new Set([2, 3, 4]); // MouseUp, Click, DblClick

interface RawInteraction {
  timestamp: number;
  type: EventSection['type'];
  target: string | null;
}

function sourceToType(source: number, interactionType?: number): EventSection['type'] | null {
  if (source === MOUSE_INTERACTION) {
    if (interactionType !== undefined && CLICK_TYPES.has(interactionType)) return 'click';
    return null;
  }
  if (source === INPUT) return 'input';
  if (source === SCROLL) return 'scroll';
  return null;
}

function typeLabel(type: EventSection['type']): string {
  switch (type) {
    case 'click':
      return 'CLICK';
    case 'input':
      return 'INPUT';
    case 'scroll':
      return 'SCROLL';
    case 'page-update':
      return 'PAGE UPDATE';
  }
}

function extractTarget(data: unknown): string | null {
  const d = data as Record<string, unknown> | undefined;
  if (!d) return null;
  const id = d.id as number | undefined;
  return id ? `node#${id}` : null;
}

const DEDUP_WINDOW = 200;
const ATTACH_WINDOW = 2000;
const MERGE_WINDOW = 1000;

function emptyDomSummary() {
  return { addedNodes: 0, removedNodes: 0, textChanges: 0, attributeChanges: 0 };
}

function aggregateDomSummary(bundles: CorrelationBundle[]): EventSection['domSummary'] {
  const summary = emptyDomSummary();
  for (const b of bundles) {
    if (b.domMutationSummary) {
      summary.addedNodes += b.domMutationSummary.addedNodes;
      summary.removedNodes += b.domMutationSummary.removedNodes;
      summary.textChanges += b.domMutationSummary.textChanges;
      summary.attributeChanges += b.domMutationSummary.attributeChanges;
    }
  }
  return summary;
}

/**
 * Groups API calls into UI-event-based sections for the replay timeline.
 * Grouping key is temporal proximity to a user interaction (click, input, scroll),
 * not an explicit event ID in the data.
 *
 * Algorithm:
 * 1. Extract UI interactions from rrweb events (clicks, inputs, scrolls)
 * 2. Deduplicate rapid same-type interactions within 200ms
 * 3. Attach correlation bundles to nearest preceding interaction within 2s
 *    — bundles with no preceding interaction become "PAGE UPDATE" events
 * 4. Merge adjacent unanchored bundles within 1s into a single PAGE UPDATE
 * 5. Resolve correlated requests from bundle apiCalls
 * 6. Attach uncorrelated (background) requests to nearest preceding event
 * 7. Omit empty sections (interactions with no resulting calls or mutations)
 */
export function buildEventSections(
  rrwebEvents: StoredRrwebEvent[],
  bundles: CorrelationBundle[],
  requests: NetworkRequest[],
): EventSection[] {
  // Step 1: Extract UI interactions
  const rawInteractions: RawInteraction[] = [];
  for (const event of rrwebEvents) {
    if (event.type !== 3) continue;
    const data = event.data as Record<string, unknown>;
    const source = data?.source as number;
    const interactionType = data?.type as number | undefined;
    const type = sourceToType(source, interactionType);
    if (!type) continue;
    rawInteractions.push({ timestamp: event.timestamp, type, target: extractTarget(data) });
  }

  // Step 2: Deduplicate rapid same-type interactions
  rawInteractions.sort((a, b) => a.timestamp - b.timestamp);
  const interactions: RawInteraction[] = [];
  for (const ri of rawInteractions) {
    const last = interactions[interactions.length - 1];
    if (last && last.type === ri.type && ri.timestamp - last.timestamp < DEDUP_WINDOW) continue;
    interactions.push(ri);
  }

  // Step 3: Attach bundles to nearest preceding interaction
  const sortedBundles = [...bundles].sort((a, b) => a.timestamp - b.timestamp);
  const correlatedIds = new Set(bundles.flatMap((b) => b.apiCalls));
  const bundlesByAnchor = new Map<number, CorrelationBundle[]>();
  // Track the timestamp of the last bundle assigned to each interaction index,
  // so we can redistribute when two bundles arrive within DEDUP_WINDOW of each other.
  const lastBundleTimestampForAnchor = new Map<number, number>();

  for (const b of sortedBundles) {
    let anchorIdx = -1;
    for (let i = interactions.length - 1; i >= 0; i--) {
      if (
        interactions[i].timestamp <= b.timestamp &&
        b.timestamp - interactions[i].timestamp <= ATTACH_WINDOW
      ) {
        const lastTs = lastBundleTimestampForAnchor.get(i);
        // If this interaction already received a bundle within DEDUP_WINDOW, try an earlier one.
        if (lastTs !== undefined && b.timestamp - lastTs < DEDUP_WINDOW) continue;
        anchorIdx = i;
        break;
      }
    }
    if (!bundlesByAnchor.has(anchorIdx)) bundlesByAnchor.set(anchorIdx, []);
    bundlesByAnchor.get(anchorIdx)!.push(b);
    lastBundleTimestampForAnchor.set(anchorIdx, b.timestamp);
  }

  // Step 4: Merge adjacent page-update bundles
  const unanchoredBundles = bundlesByAnchor.get(-1) || [];
  const pageUpdateGroups: CorrelationBundle[][] = [];
  for (const b of unanchoredBundles) {
    const lastGroup = pageUpdateGroups[pageUpdateGroups.length - 1];
    if (lastGroup && b.timestamp - lastGroup[lastGroup.length - 1].timestamp <= MERGE_WINDOW) {
      lastGroup.push(b);
    } else {
      pageUpdateGroups.push([b]);
    }
  }

  // Build sections
  const sections: EventSection[] = [];

  for (let i = 0; i < interactions.length; i++) {
    const interaction = interactions[i];
    const attachedBundles = bundlesByAnchor.get(i) || [];
    sections.push({
      id: `event-${interaction.type}-${interaction.timestamp}`,
      timestamp: interaction.timestamp,
      type: interaction.type,
      label: typeLabel(interaction.type),
      target: interaction.target,
      bundles: attachedBundles,
      correlatedRequests: [],
      backgroundRequests: [],
      domSummary: aggregateDomSummary(attachedBundles),
    });
  }

  for (const group of pageUpdateGroups) {
    sections.push({
      id: `event-page-update-${group[0].timestamp}`,
      timestamp: group[0].timestamp,
      type: 'page-update',
      label: 'PAGE UPDATE',
      target: null,
      bundles: group,
      correlatedRequests: [],
      backgroundRequests: [],
      domSummary: aggregateDomSummary(group),
    });
  }

  sections.sort((a, b) => a.timestamp - b.timestamp);

  // Step 5: Resolve correlated requests from bundle apiCalls
  for (const section of sections) {
    const ids = new Set(section.bundles.flatMap((b) => b.apiCalls));
    section.correlatedRequests = requests
      .filter((r) => ids.has(r.requestId))
      .sort((a, b) => a.startTime - b.startTime);
  }

  // Step 6: Attach background requests
  const uncorrelated = requests
    .filter((r) => !correlatedIds.has(r.requestId))
    .sort((a, b) => a.startTime - b.startTime);

  for (const req of uncorrelated) {
    let target = sections[0];
    for (const section of sections) {
      if (section.timestamp <= req.startTime) {
        target = section;
      } else {
        break;
      }
    }
    if (target) target.backgroundRequests.push(req);
  }

  // Step 7: Omit empty sections
  return sections.filter((s) => s.bundles.length > 0 || s.backgroundRequests.length > 0);
}
