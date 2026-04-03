# Event-Based Timeline Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the replay timeline from individual-API-call grouping to UI-event-based sections, where each section represents a user interaction (click, input, scroll) or page update that triggered API calls and DOM mutations.

**Architecture:** Pre-compute `EventSection[]` once at session load from rrweb events + correlation bundles + network requests. Store in replay store. Timeline panel maps over event sections. Scrubber shows event-level ticks instead of per-request markers. Bidirectional sync between panel, scrubber, and player at event level.

**Tech Stack:** Svelte 5 (legacy Svelte 4 syntax), TypeScript, Vitest

**Spec:** `docs/superpowers/specs/2026-04-03-event-based-timeline-design.md`

---

### File Map

| File                                                   | Action | Responsibility                                                                     |
| ------------------------------------------------------ | ------ | ---------------------------------------------------------------------------------- |
| `extension/src/replay/lib/event-sections.ts`           | Create | `EventSection` type + `buildEventSections()` pure function                         |
| `extension/src/replay/lib/event-sections.test.ts`      | Create | Tests for event section building logic                                             |
| `extension/src/replay/lib/group-naming.ts`             | Modify | Add `eventTypeLabel()`, keep `formatGroupTimestamp`                                |
| `extension/src/replay/lib/group-naming.test.ts`        | Modify | Add tests for `eventTypeLabel`                                                     |
| `extension/src/replay/stores/replay-store.ts`          | Modify | Add `eventSections` to store, `findActiveEvent()`, `setActiveEventId()`            |
| `extension/src/replay/stores/replay-store.test.ts`     | Modify | Add `findActiveEvent` tests                                                        |
| `extension/entrypoints/replay/App.svelte`              | Modify | Call `buildEventSections()` at load, pass to store                                 |
| `extension/src/replay/components/EventGroup.svelte`    | Create | Renders event section: header, DOM summary, correlated calls, background sub-group |
| `extension/src/replay/components/Timeline.svelte`      | Modify | Rewrite to map over `eventSections`, use `EventGroup`                              |
| `extension/src/replay/components/TimelineEntry.svelte` | Modify | Remove info icon, make entire row open detail                                      |
| `extension/src/replay/components/Scrubber.svelte`      | Modify | Event-level ticks, click handler, mini picker, active glow                         |

---

### Task 1: Create `buildEventSections` pure function with tests

**Files:**

- Create: `extension/src/replay/lib/event-sections.ts`
- Create: `extension/src/replay/lib/event-sections.test.ts`

- [ ] **Step 1: Write failing tests**

Create `extension/src/replay/lib/event-sections.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildEventSections } from './event-sections';
import type { StoredRrwebEvent, CorrelationBundle, NetworkRequest } from 'underpixel-shared';

// Helpers
function rrwebInteraction(
  timestamp: number,
  source: number,
  interactionType?: number,
): StoredRrwebEvent {
  return {
    sessionId: 's1',
    timestamp,
    type: 3, // IncrementalSnapshot
    data: { source, type: interactionType },
  };
}

function rrwebMutation(timestamp: number): StoredRrwebEvent {
  return {
    sessionId: 's1',
    timestamp,
    type: 3,
    data: { source: 0, adds: [{ node: {} }], removes: [], texts: [], attributes: [] },
  };
}

function bundle(
  id: string,
  timestamp: number,
  apiCalls: string[],
  summary?: Partial<CorrelationBundle['domMutationSummary']>,
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
    const events = [
      rrwebInteraction(1000, 2, 2), // MouseInteraction click at T=1000
    ];
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
    const events = [
      rrwebInteraction(1000, 2, 2), // click
    ];
    const bundles = [bundle('b1', 1500, ['r1'])];
    const requests = [
      request('r1', 1400),
      request('r2', 1600), // uncorrelated
    ];

    const sections = buildEventSections(events, bundles, requests);

    expect(sections).toHaveLength(1);
    expect(sections[0].backgroundRequests).toHaveLength(1);
    expect(sections[0].backgroundRequests[0].requestId).toBe('r2');
  });

  it('attaches pre-first-event background requests to first event', () => {
    const events = [rrwebInteraction(5000, 2, 2)];
    const bundles = [bundle('b1', 5500, ['r2'])];
    const requests = [
      request('r1', 1000), // before first event
      request('r2', 5400),
    ];

    const sections = buildEventSections(events, bundles, requests);

    expect(sections).toHaveLength(1);
    expect(sections[0].backgroundRequests).toHaveLength(1);
    expect(sections[0].backgroundRequests[0].requestId).toBe('r1');
  });

  it('deduplicates rapid interactions of same type within 200ms', () => {
    const events = [
      rrwebInteraction(1000, 2, 2), // click
      rrwebInteraction(1100, 2, 2), // rapid second click — should be deduped
    ];
    const bundles = [bundle('b1', 1500, ['r1'])];
    const requests = [request('r1', 1400)];

    const sections = buildEventSections(events, bundles, requests);

    // Only one section from the first click
    expect(sections).toHaveLength(1);
    expect(sections[0].timestamp).toBe(1000);
  });

  it('keeps different interaction types within 200ms as separate events', () => {
    const events = [
      rrwebInteraction(1000, 2, 2), // click
      rrwebInteraction(1100, 5), // input
    ];
    const bundles = [bundle('b1', 1400, ['r1']), bundle('b2', 1500, ['r2'])];
    const requests = [request('r1', 1300), request('r2', 1450)];

    const sections = buildEventSections(events, bundles, requests);

    expect(sections).toHaveLength(2);
    expect(sections[0].type).toBe('click');
    expect(sections[1].type).toBe('input');
  });

  it('merges adjacent page-update bundles within 1 second', () => {
    const events: StoredRrwebEvent[] = [];
    const bundles = [
      bundle('b1', 1000, ['r1']),
      bundle('b2', 1500, ['r2']), // within 1s of b1
    ];
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
    const events = [
      rrwebInteraction(1000, 2, 2), // click with no effect
      rrwebInteraction(5000, 2, 2), // click that triggers API call
    ];
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
    const sections = buildEventSections([], [], []);
    expect(sections).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /c/Projects/web-tool/underpixel && pnpm -F extension test -- --run`

Expected: FAIL — `event-sections.ts` module not found.

- [ ] **Step 3: Implement `buildEventSections`**

Create `extension/src/replay/lib/event-sections.ts`:

```typescript
import type { StoredRrwebEvent, CorrelationBundle, NetworkRequest } from 'underpixel-shared';

export interface EventSection {
  id: string;
  timestamp: number;
  type: 'click' | 'input' | 'scroll' | 'page-update';
  label: string;
  target: string | null;
  bundles: CorrelationBundle[];
  backgroundRequests: NetworkRequest[];
  domSummary: {
    addedNodes: number;
    removedNodes: number;
    textChanges: number;
    attributeChanges: number;
  };
}

/** rrweb IncrementalSource values for user interactions */
const MOUSE_INTERACTION = 2;
const INPUT = 5;
const SCROLL = 3;

/** rrweb MouseInteractions that count as clicks */
const CLICK_TYPES = new Set([2, 3, 4]); // MouseUp, Click, DblClick

interface RawInteraction {
  timestamp: number;
  type: EventSection['type'];
  target: string | null;
}

function sourceToType(source: number, interactionType?: number): EventSection['type'] | null {
  if (source === MOUSE_INTERACTION) {
    if (interactionType !== undefined && CLICK_TYPES.has(interactionType)) return 'click';
    return null; // MouseDown, MouseMove etc. — not a meaningful anchor
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
  // rrweb MouseInteraction events sometimes have id + tag info
  const id = d.id as number | undefined;
  return id ? `node#${id}` : null;
}

const DEDUP_WINDOW = 200; // ms — same-type interactions within this are deduped
const ATTACH_WINDOW = 2000; // ms — max gap between interaction and bundle to attach
const MERGE_WINDOW = 1000; // ms — adjacent page-update bundles merge within this

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

export function buildEventSections(
  rrwebEvents: StoredRrwebEvent[],
  bundles: CorrelationBundle[],
  requests: NetworkRequest[],
): EventSection[] {
  // Step 1: Extract UI interactions from rrweb events
  const rawInteractions: RawInteraction[] = [];
  for (const event of rrwebEvents) {
    if (event.type !== 3) continue; // Only IncrementalSnapshot
    const data = event.data as Record<string, unknown>;
    const source = data?.source as number;
    const interactionType = data?.type as number | undefined;
    const type = sourceToType(source, interactionType);
    if (!type) continue;
    rawInteractions.push({
      timestamp: event.timestamp,
      type,
      target: extractTarget(data),
    });
  }

  // Step 2: Deduplicate rapid interactions of same type
  rawInteractions.sort((a, b) => a.timestamp - b.timestamp);
  const interactions: RawInteraction[] = [];
  for (const ri of rawInteractions) {
    const last = interactions[interactions.length - 1];
    if (last && last.type === ri.type && ri.timestamp - last.timestamp < DEDUP_WINDOW) {
      continue; // Skip duplicate
    }
    interactions.push(ri);
  }

  // Step 3: Attach bundles to nearest preceding interaction
  const sortedBundles = [...bundles].sort((a, b) => a.timestamp - b.timestamp);
  const correlatedIds = new Set(bundles.flatMap((b) => b.apiCalls));

  // Map: interaction index -> bundles attached to it. -1 = unanchored (page-update)
  const bundlesByAnchor = new Map<number, CorrelationBundle[]>();

  for (const b of sortedBundles) {
    let anchorIdx = -1;
    for (let i = interactions.length - 1; i >= 0; i--) {
      if (
        interactions[i].timestamp <= b.timestamp &&
        b.timestamp - interactions[i].timestamp <= ATTACH_WINDOW
      ) {
        anchorIdx = i;
        break;
      }
    }
    if (!bundlesByAnchor.has(anchorIdx)) bundlesByAnchor.set(anchorIdx, []);
    bundlesByAnchor.get(anchorIdx)!.push(b);
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

  // Build event sections
  const sections: EventSection[] = [];

  // From UI interactions
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
      backgroundRequests: [], // filled in step 5
      domSummary: aggregateDomSummary(attachedBundles),
    });
  }

  // From page-update groups
  for (const group of pageUpdateGroups) {
    sections.push({
      id: `event-page-update-${group[0].timestamp}`,
      timestamp: group[0].timestamp,
      type: 'page-update',
      label: 'PAGE UPDATE',
      target: null,
      bundles: group,
      backgroundRequests: [], // filled in step 5
      domSummary: aggregateDomSummary(group),
    });
  }

  // Sort chronologically
  sections.sort((a, b) => a.timestamp - b.timestamp);

  // Step 5: Attach background requests to nearest preceding event
  const uncorrelated = requests
    .filter((r) => !correlatedIds.has(r.requestId))
    .sort((a, b) => a.startTime - b.startTime);

  for (const req of uncorrelated) {
    // Find nearest preceding section
    let target = sections[0]; // default: first section
    for (const section of sections) {
      if (section.timestamp <= req.startTime) {
        target = section;
      } else {
        break;
      }
    }
    if (target) {
      target.backgroundRequests.push(req);
    }
  }

  // Step 6: Omit empty event sections (interaction with no bundles, no requests)
  const nonEmpty = sections.filter((s) => s.bundles.length > 0 || s.backgroundRequests.length > 0);

  return nonEmpty;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /c/Projects/web-tool/underpixel && pnpm -F extension test -- --run`

Expected: All tests PASS.

- [ ] **Step 5: Run lint**

Run: `cd /c/Projects/web-tool/underpixel && pnpm lint`

Expected: Clean.

---

### Task 2: Add `eventTypeLabel` to group-naming and update store

**Files:**

- Modify: `extension/src/replay/lib/group-naming.ts`
- Modify: `extension/src/replay/lib/group-naming.test.ts`
- Modify: `extension/src/replay/stores/replay-store.ts`
- Modify: `extension/src/replay/stores/replay-store.test.ts`

- [ ] **Step 1: Add `eventTypeLabel` function and tests**

Add to `group-naming.ts` after the existing functions:

```typescript
/** Format an event section header: "TYPE (m:ss)" */
export function formatEventHeader(
  type: string,
  timestamp: number,
  sessionStartTime: number,
): string {
  return `${type} (${formatGroupTimestamp(timestamp - sessionStartTime)})`;
}
```

Add tests to `group-naming.test.ts`:

```typescript
describe('formatEventHeader', () => {
  it('formats click event header', () => {
    expect(formatEventHeader('CLICK', 1006000, 1000000)).toBe('CLICK (0:06)');
  });
  it('formats page update header', () => {
    expect(formatEventHeader('PAGE UPDATE', 1000500, 1000000)).toBe('PAGE UPDATE (0:00)');
  });
});
```

- [ ] **Step 2: Update replay store**

In `replay-store.ts`, add `EventSection` import and store fields:

```typescript
import type { EventSection } from '../lib/event-sections';
```

Add to `ReplayState`:

```typescript
export interface ReplayState {
  currentTime: number;
  session: CaptureSession | null;
  allRequests: NetworkRequest[];
  bundles: CorrelationBundle[];
  eventSections: EventSection[]; // NEW
  activeEventId: string | null; // NEW
  selectedCallId: string | null;
  detailCallId: string | null;
  searchQuery: string;
  filters: FilterState;
  isPlaying: boolean;
}
```

Add to `initial`:

```typescript
eventSections: [],
activeEventId: null,
```

Add `findActiveEvent` pure function (exported for testing):

```typescript
/** Find the event section active at a given absolute time */
export function findActiveEvent(
  sections: EventSection[],
  currentTime: number,
): EventSection | null {
  let active: EventSection | null = null;
  for (const s of sections) {
    if (s.timestamp <= currentTime) {
      active = s;
    } else {
      break;
    }
  }
  return active;
}
```

Add convenience updater:

```typescript
export function setActiveEventId(id: string | null) {
  replayStore.update((s) => ({ ...s, activeEventId: id }));
}
```

Update `loadSessionData` signature to accept event sections:

```typescript
export function loadSessionData(
  session: CaptureSession,
  requests: NetworkRequest[],
  bundles: CorrelationBundle[],
  eventSections: EventSection[],
) {
  replayStore.set({
    ...initial,
    session,
    allRequests: requests,
    bundles,
    eventSections,
  });
}
```

- [ ] **Step 3: Add `findActiveEvent` test**

Add to `replay-store.test.ts`:

```typescript
import { findActiveGroup, findCallsAtTime, findActiveEvent } from './replay-store';
import type { EventSection } from '../lib/event-sections';

const eventSection = (id: string, timestamp: number): EventSection => ({
  id,
  timestamp,
  type: 'click',
  label: 'CLICK',
  target: null,
  bundles: [],
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
```

- [ ] **Step 4: Run tests and lint**

Run: `cd /c/Projects/web-tool/underpixel && pnpm lint && pnpm -F extension test -- --run`

Expected: All pass, lint clean.

---

### Task 3: Update App.svelte to build and load event sections

**Files:**

- Modify: `extension/entrypoints/replay/App.svelte`

- [ ] **Step 1: Import and call `buildEventSections`**

In `App.svelte`, add the import:

```typescript
import { buildEventSections } from '../../src/replay/lib/event-sections';
```

In the `loadSession` function, after the parallel data fetch and before `loadSessionData`, build event sections from the stored rrweb events:

Replace lines 49-56 (from `loadSessionData` through the rrwebEvents mapping):

```typescript
const eventSections = buildEventSections(storedEvents, bundles, requests);
console.log(`[UnderPixel Replay] Built ${eventSections.length} event sections`);

loadSessionData(session, requests, bundles, eventSections);

rrwebEvents = storedEvents.map((e) => ({
  type: e.type,
  data: e.data,
  timestamp: e.timestamp,
})) as eventWithTime[];
```

- [ ] **Step 2: Run lint and build**

Run: `cd /c/Projects/web-tool/underpixel && pnpm lint && pnpm build`

Expected: Clean lint, successful build.

---

### Task 4: Create `EventGroup.svelte` component

**Files:**

- Create: `extension/src/replay/components/EventGroup.svelte`
- Modify: `extension/src/replay/components/TimelineEntry.svelte`

- [ ] **Step 1: Create `EventGroup.svelte`**

```svelte
<script lang="ts">
  import type { CorrelationBundle, NetworkRequest } from 'underpixel-shared';
  import { replayStore, openDetail } from '../stores/replay-store';
  import TimelineEntry from './TimelineEntry.svelte';
  import { formatGroupTimestamp } from '../lib/group-naming';

  export let id: string;
  export let label: string;
  export let timestamp: number;
  export let sessionStart: number;
  export let bundles: CorrelationBundle[];
  export let backgroundRequests: NetworkRequest[];
  export let domSummary: {
    addedNodes: number;
    removedNodes: number;
    textChanges: number;
    attributeChanges: number;
  };
  export let isActive: boolean = false;
  export let onSeek: (eventTimestamp: number) => void = () => {};

  let bgExpanded = false;

  $: timeLabel = formatGroupTimestamp(timestamp - sessionStart);
  $: summaryText = `${domSummary.addedNodes} nodes added, ${domSummary.textChanges} text changes`;

  $: correlatedRequests = (() => {
    const ids = new Set(bundles.flatMap((b) => b.apiCalls));
    const allReqs = $replayStore.allRequests;
    return allReqs
      .filter((r) => ids.has(r.requestId))
      .sort((a, b) => a.startTime - b.startTime);
  })();

  function handleHeaderClick() {
    onSeek(timestamp);
  }

  function toggleBg() {
    bgExpanded = !bgExpanded;
  }
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<div class="event-group" class:active={isActive}>
  <div
    class="event-header"
    on:click={handleHeaderClick}
    role="button"
    tabindex="0"
  >
    <span class="event-symbol">♥</span>
    <span class="event-label">{label} ({timeLabel})</span>
    {#if isActive}
      <span class="now-badge">NOW</span>
    {/if}
  </div>

  {#if bundles.length > 0}
    <div class="dom-summary">{summaryText}</div>
  {/if}

  <div class="correlated-entries">
    {#each correlatedRequests as request (request.requestId)}
      <TimelineEntry {request} on:click={() => openDetail(request.requestId)} />
    {/each}
  </div>

  {#if backgroundRequests.length > 0}
    <!-- svelte-ignore a11y-no-noninteractive-tabindex -->
    <div
      class="bg-header"
      on:click={toggleBg}
      role="button"
      tabindex="0"
    >
      <span class="bg-symbol">♦</span>
      <span class="bg-label">
        {backgroundRequests.length === 1
          ? '1 background call'
          : `${backgroundRequests.length} background calls`}
      </span>
      <span class="bg-indicator">{bgExpanded ? '▾' : '▸'}</span>
    </div>
    {#if bgExpanded}
      <div class="bg-entries">
        {#each backgroundRequests as request (request.requestId)}
          <TimelineEntry {request} muted on:click={() => openDetail(request.requestId)} />
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  .event-group {
    padding: 4px 8px;
    margin: 2px 4px;
    border-radius: 4px;
    border: 2px solid transparent;
    transition: border-color 0.2s, background 0.2s;
  }

  .event-group.active {
    border-color: var(--warning);
    background: rgba(255, 204, 128, 0.05);
  }

  .event-header {
    font-family: var(--font-pixel);
    font-size: 7px;
    color: var(--text-dim);
    padding: 6px 4px 4px;
    letter-spacing: 1px;
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    user-select: none;
  }

  .event-group.active .event-header {
    color: var(--warning);
  }

  .event-header:hover {
    color: var(--text-secondary);
  }

  .event-symbol {
    font-size: 10px;
  }

  .now-badge {
    font-family: var(--font-pixel);
    font-size: 7px;
    color: var(--accent);
    background: rgba(255, 138, 128, 0.2);
    padding: 2px 8px;
    border: 2px solid var(--accent);
    letter-spacing: 0;
  }

  .dom-summary {
    font-family: var(--font-body);
    font-size: 13px;
    color: var(--warning);
    padding: 2px 10px 4px;
  }

  .bg-header {
    font-family: var(--font-pixel);
    font-size: 7px;
    color: var(--text-muted);
    padding: 6px 4px 4px;
    letter-spacing: 1px;
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    user-select: none;
  }

  .bg-header:hover {
    color: var(--text-secondary);
  }

  .bg-symbol {
    font-size: 10px;
  }

  .bg-indicator {
    font-size: 10px;
    margin-left: auto;
    color: var(--text-muted);
  }
</style>
```

- [ ] **Step 2: Update TimelineEntry — remove info icon, make row open detail**

In `TimelineEntry.svelte`, replace the click handler and remove the detail button:

Replace `handleClick` function:

```typescript
function handleClick() {
  openDetail(request.requestId);
}
```

Remove the `handleDetailClick` function entirely.

Remove from the template the detail button:

```svelte
      <button class="detail-btn" on:click={handleDetailClick} title="View details">
        ⓘ
      </button>
```

Remove the `.detail-btn` and `.detail-btn:hover` CSS rules.

- [ ] **Step 3: Run lint**

Run: `cd /c/Projects/web-tool/underpixel && pnpm lint`

Expected: Clean.

---

### Task 5: Rewrite Timeline.svelte to use EventGroup

**Files:**

- Modify: `extension/src/replay/components/Timeline.svelte`

- [ ] **Step 1: Replace entire `<script>` block**

```svelte
<script lang="ts">
  import { replayStore, findActiveEvent } from '../stores/replay-store';
  import EventGroup from './EventGroup.svelte';
  import SearchBar from './SearchBar.svelte';
  import { matchesFilters, matchesSearch } from '../lib/search';
  import type { EventSection } from '../lib/event-sections';

  export let onSeek: (timeMs: number) => void = () => {};

  let scrollContainer: HTMLDivElement;

  // Filter event sections based on search/filters applied to their requests
  $: visibleSections = filterSections(
    $replayStore.eventSections,
    $replayStore.searchQuery,
    $replayStore.filters,
  );

  $: sessionStart = $replayStore.session?.startTime ?? 0;

  $: activeEventId = (() => {
    const section = findActiveEvent(
      $replayStore.eventSections,
      $replayStore.session
        ? $replayStore.currentTime + $replayStore.session.startTime
        : 0,
    );
    return section?.id ?? null;
  })();

  $: totalCalls = $replayStore.allRequests.length;
  $: eventCount = visibleSections.length;
  $: errorCount = $replayStore.allRequests.filter(
    (r) => r.statusCode && r.statusCode >= 400,
  ).length;

  function filterSections(
    sections: EventSection[],
    searchQuery: string,
    filters: import('../lib/search').FilterState,
  ): EventSection[] {
    if (!searchQuery && Object.values(filters).every((v) => !v)) return sections;

    return sections.filter((s) => {
      const allRequests = [
        ...s.bundles.flatMap((b) => {
          const ids = new Set(b.apiCalls);
          return $replayStore.allRequests.filter((r) => ids.has(r.requestId));
        }),
        ...s.backgroundRequests,
      ];
      return allRequests.some(
        (r) => matchesFilters(r, filters) && matchesSearch(r, searchQuery),
      );
    });
  }

  function handleSeek(eventTimestamp: number) {
    // Seek to 200ms before the event so user sees the page state just before the mutation
    const offset = eventTimestamp - sessionStart - 200;
    onSeek(Math.max(0, offset));
  }

  // Auto-scroll during playback
  let lastAutoScrollEventId: string | null = null;
  $: if ($replayStore.isPlaying && activeEventId && activeEventId !== lastAutoScrollEventId && scrollContainer) {
    lastAutoScrollEventId = activeEventId;
    const activeIdx = visibleSections.findIndex((s) => s.id === activeEventId);
    if (activeIdx >= 0) {
      const groupEls = scrollContainer.querySelectorAll('.event-wrapper');
      groupEls[activeIdx]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }
</script>
```

- [ ] **Step 2: Replace template**

```svelte
<div class="timeline">
  <SearchBar />

  <div class="timeline-scroll" bind:this={scrollContainer}>
    {#each visibleSections as section (section.id)}
      <div class="event-wrapper">
        <EventGroup
          id={section.id}
          label={section.label}
          timestamp={section.timestamp}
          {sessionStart}
          bundles={section.bundles}
          backgroundRequests={section.backgroundRequests}
          domSummary={section.domSummary}
          isActive={activeEventId === section.id}
          onSeek={handleSeek}
        />
      </div>
    {/each}

    {#if visibleSections.length === 0}
      <div class="empty-timeline">
        <span class="empty-text">No events</span>
      </div>
    {/if}
  </div>

  <div class="summary-bar">
    <span>{totalCalls} calls</span>
    <span>{eventCount} events</span>
    {#if errorCount > 0}
      <span class="error-count">{errorCount} error{errorCount > 1 ? 's' : ''}</span>
    {/if}
  </div>
</div>
```

Keep the existing `<style>` block unchanged.

- [ ] **Step 3: Wire `onSeek` from App.svelte to Timeline**

In `App.svelte`, update the Timeline usage:

```svelte
<Timeline onSeek={(t) => playerComponent?.goto(t)} />
```

- [ ] **Step 4: Run lint and tests**

Run: `cd /c/Projects/web-tool/underpixel && pnpm lint && pnpm -F extension test -- --run`

Expected: All pass, lint clean.

---

### Task 6: Rewrite Scrubber for event-level ticks

**Files:**

- Modify: `extension/src/replay/components/Scrubber.svelte`

- [ ] **Step 1: Replace marker computation with event ticks**

Replace the `cachedMarkers` reactive block (lines 22-41) with:

```typescript
$: eventTicks = (() => {
  const sections = $replayStore.eventSections;
  const start = sessionStart;
  const dur = totalDuration;
  return sections.map((s) => ({
    id: s.id,
    label: s.label,
    position: dur > 0 ? ((s.timestamp - start) / dur) * 100 : 0,
  }));
})();

// Group overlapping ticks (within 1% of scrubber width)
$: tickGroups = (() => {
  const groups: { ticks: typeof eventTicks; position: number }[] = [];
  for (const tick of eventTicks) {
    const last = groups[groups.length - 1];
    if (last && Math.abs(tick.position - last.position) < 1) {
      last.ticks.push(tick);
    } else {
      groups.push({ ticks: [tick], position: tick.position });
    }
  }
  return groups;
})();

let pickerGroup: { ticks: typeof eventTicks; position: number } | null = null;

$: activeTickId = (() => {
  const sections = $replayStore.eventSections;
  const absTime = $replayStore.session
    ? $replayStore.currentTime + $replayStore.session.startTime
    : 0;
  let active: string | null = null;
  for (const s of sections) {
    if (s.timestamp <= absTime) active = s.id;
    else break;
  }
  return active;
})();

export let onEventSelect: (eventId: string, eventTimestamp: number) => void = () => {};
```

- [ ] **Step 2: Replace marker HTML with event ticks and mini picker**

Replace the `{#each cachedMarkers ...}` block in the track with:

```svelte
    {#each tickGroups as group}
      <!-- svelte-ignore a11y-click-events-have-key-events -->
      <div
        class="tick"
        class:active={group.ticks.some((t) => t.id === activeTickId)}
        style="left: {group.position}%"
        on:click|stopPropagation={() => {
          if (group.ticks.length === 1) {
            const section = $replayStore.eventSections.find((s) => s.id === group.ticks[0].id);
            if (section) onEventSelect(section.id, section.timestamp);
          } else {
            pickerGroup = pickerGroup === group ? null : group;
          }
        }}
        role="button"
        tabindex="0"
      ></div>
    {/each}

    {#if pickerGroup}
      <div class="tick-picker" style="left: {pickerGroup.position}%">
        {#each pickerGroup.ticks as tick}
          <!-- svelte-ignore a11y-click-events-have-key-events -->
          <div
            class="tick-picker-item"
            on:click|stopPropagation={() => {
              const section = $replayStore.eventSections.find((s) => s.id === tick.id);
              if (section) onEventSelect(section.id, section.timestamp);
              pickerGroup = null;
            }}
            role="button"
            tabindex="0"
          >
            {tick.label}
          </div>
        {/each}
      </div>
    {/if}
```

- [ ] **Step 3: Replace `.marker` CSS with tick and picker styles**

Remove the `.marker` CSS rule and add:

```css
.tick {
  position: absolute;
  top: -3px;
  width: 4px;
  height: 14px;
  background: var(--accent);
  transform: translateX(-50%);
  cursor: pointer;
  z-index: 1;
  transition: box-shadow 0.2s;
}

.tick.active {
  box-shadow: 0 0 6px 2px rgba(255, 138, 128, 0.5);
}

.tick-picker {
  position: absolute;
  bottom: 16px;
  transform: translateX(-50%);
  background: var(--surface);
  border: 2px solid var(--border);
  border-radius: 4px;
  padding: 4px 0;
  z-index: 10;
  min-width: 120px;
}

.tick-picker-item {
  font-family: var(--font-ui);
  font-size: 10px;
  color: var(--text-secondary);
  padding: 4px 12px;
  cursor: pointer;
  white-space: nowrap;
}

.tick-picker-item:hover {
  background: var(--surface-active);
  color: var(--text-primary);
}
```

- [ ] **Step 4: Wire event selection in App.svelte**

Update the Scrubber usage in `App.svelte`:

```svelte
<Scrubber
  {totalDuration}
  onToggle={() => playerComponent?.toggle()}
  onSeek={(t) => playerComponent?.goto(t)}
  onSpeedChange={(s) => playerComponent?.setSpeed(s)}
  onEventSelect={(id, ts) => {
    const offset = ts - ($replayStore.session?.startTime ?? 0) - 200;
    playerComponent?.goto(Math.max(0, offset));
  }}
/>
```

- [ ] **Step 5: Run lint, tests, and build**

Run: `cd /c/Projects/web-tool/underpixel && pnpm lint && pnpm test && pnpm build`

Expected: All pass, lint clean, build succeeds.

---

### Task 7: Clean up old files and verify end-to-end

**Files:**

- Delete: `extension/src/replay/components/CorrelationGroup.svelte`
- Modify: `extension/src/replay/lib/group-naming.ts` (remove unused functions)
- Modify: `extension/src/replay/lib/group-naming.test.ts` (remove unused tests)

- [ ] **Step 1: Delete CorrelationGroup.svelte**

```bash
rm extension/src/replay/components/CorrelationGroup.svelte
```

- [ ] **Step 2: Remove unused functions from group-naming.ts**

Remove `generateGroupName`, `generateGroupSymbol`, and `formatGroupLabel` — these were bundle-centric and are replaced by the event-section approach. Keep `formatGroupTimestamp` (still used by EventGroup) and `formatEventHeader` (added in Task 2).

Updated `group-naming.ts`:

```typescript
/** Format a ms offset as m:ss for group header display */
export function formatGroupTimestamp(offsetMs: number): string {
  const totalSeconds = Math.floor(Math.max(0, offsetMs) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** Format an event section header: "TYPE (m:ss)" */
export function formatEventHeader(
  type: string,
  timestamp: number,
  sessionStartTime: number,
): string {
  return `${type} (${formatGroupTimestamp(timestamp - sessionStartTime)})`;
}
```

- [ ] **Step 3: Update group-naming.test.ts**

Remove tests for `generateGroupName`, `generateGroupSymbol`, `formatGroupLabel`. Keep `formatGroupTimestamp` and `formatEventHeader` tests:

```typescript
import { describe, it, expect } from 'vitest';
import { formatGroupTimestamp, formatEventHeader } from './group-naming';

describe('formatGroupTimestamp', () => {
  it('formats 0ms offset as 0:00', () => {
    expect(formatGroupTimestamp(0)).toBe('0:00');
  });
  it('formats seconds', () => {
    expect(formatGroupTimestamp(1500)).toBe('0:01');
  });
  it('formats minutes and seconds', () => {
    expect(formatGroupTimestamp(65000)).toBe('1:05');
  });
  it('formats large offsets', () => {
    expect(formatGroupTimestamp(754000)).toBe('12:34');
  });
  it('clamps negative offsets to 0:00', () => {
    expect(formatGroupTimestamp(-500)).toBe('0:00');
  });
});

describe('formatEventHeader', () => {
  it('formats click event header', () => {
    expect(formatEventHeader('CLICK', 1006000, 1000000)).toBe('CLICK (0:06)');
  });
  it('formats page update header', () => {
    expect(formatEventHeader('PAGE UPDATE', 1000500, 1000000)).toBe('PAGE UPDATE (0:00)');
  });
});
```

- [ ] **Step 4: Run full test suite, lint, and build**

Run: `cd /c/Projects/web-tool/underpixel && pnpm lint && pnpm test && pnpm build`

Expected: All tests pass, lint clean, build succeeds.

- [ ] **Step 5: Verify spec coverage**

| Spec requirement                                                                                                      | Task                         |
| --------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `EventSection` data model                                                                                             | Task 1 (type + builder)      |
| Build algorithm (extract interactions, dedup, attach bundles, merge page-updates, attach background, sort, aggregate) | Task 1                       |
| Event sections in store                                                                                               | Task 2                       |
| `findActiveEvent`                                                                                                     | Task 2                       |
| `buildEventSections` called at load                                                                                   | Task 3                       |
| Event section header with type + timestamp                                                                            | Task 4 (EventGroup)          |
| DOM summary display                                                                                                   | Task 4 (EventGroup)          |
| Correlated calls under event                                                                                          | Task 4 (EventGroup)          |
| Background calls collapsed sub-group                                                                                  | Task 4 (EventGroup)          |
| Click header → seek 200ms before                                                                                      | Task 5 (Timeline handleSeek) |
| NOW badge on active event                                                                                             | Task 4 (EventGroup)          |
| Auto-scroll during playback                                                                                           | Task 5 (Timeline)            |
| Remove info icon from TimelineEntry                                                                                   | Task 4                       |
| Scrubber event-level ticks                                                                                            | Task 6                       |
| Same accent color for all ticks                                                                                       | Task 6                       |
| Active tick glow                                                                                                      | Task 6                       |
| Mini picker for overlapping ticks                                                                                     | Task 6                       |
| Bidirectional sync (panel ↔ scrubber ↔ player)                                                                        | Tasks 5 + 6                  |
| Chronological ordering                                                                                                | Task 1 (sort in builder)     |
| Edge: zero interactions → all PAGE UPDATE                                                                             | Task 1 (test)                |
| Edge: interaction with no effect → omitted                                                                            | Task 1 (test)                |
| Edge: rapid-fire dedup                                                                                                | Task 1 (test)                |
| Clean up old CorrelationGroup                                                                                         | Task 7                       |
