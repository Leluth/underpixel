# Event-Based Timeline Redesign

Restructures the replay timeline around **UI events** (clicks, inputs, scrolls, page loads) instead of individual API calls. Each event section groups the correlated API calls, DOM mutation summary, and background calls that resulted from a user interaction. The scrubber, API panel, and replay player all sync at the event level.

No changes to the correlation engine, IDB schema, capture pipeline, or bridge. This is a replay UI restructure only.

## 1. EventSection Data Model

Pre-computed once at session load time, stored in the replay store.

```typescript
interface EventSection {
  id: string;
  timestamp: number; // epoch ms - UI event time, or bundle time for PAGE UPDATE
  type: 'click' | 'input' | 'scroll' | 'page-update';
  label: string; // "CLICK" / "INPUT" / "SCROLL" / "PAGE UPDATE"
  target: string | null; // rrweb target description if available
  bundles: CorrelationBundle[]; // correlated bundles attached to this event
  backgroundRequests: NetworkRequest[]; // uncorrelated requests attached to this event
  domSummary: {
    // aggregated from all bundles in this section
    addedNodes: number;
    removedNodes: number;
    textChanges: number;
    attributeChanges: number;
  };
}
```

### Build Algorithm (`buildEventSections`)

Runs once when session data loads. Inputs: rrweb events, correlation bundles, network requests, session start time.

1. **Extract UI interactions** from rrweb events: scan for `type=3` (IncrementalSnapshot) with `source=2` (MouseInteraction), `source=5` (Input), or `source=3` (Scroll). Each becomes an event anchor with a timestamp and type.

2. **Deduplicate rapid interactions**: If multiple interactions of the same type fire within 200ms, keep only the first. This prevents a double-click from creating two event sections.

3. **Attach bundles to events**: For each correlation bundle, find the nearest preceding UI interaction within 2 seconds. If found, attach the bundle to that event. If no preceding interaction exists, the bundle becomes a standalone "page-update" event.

4. **Merge adjacent page-update events**: If multiple unanchored bundles have timestamps within 1 second of each other, merge them into a single "page-update" event section.

5. **Attach background requests**: For each uncorrelated request (not in any bundle's `apiCalls`), attach it to the nearest preceding event section. If before the first event, attach to the first event.

6. **Sort event sections** chronologically by timestamp.

7. **Aggregate DOM summaries**: For each section, sum `addedNodes`, `removedNodes`, `textChanges`, `attributeChanges` across all bundles in that section.

## 2. API Panel (Timeline)

The primary selectable unit is the **event section**, not the individual API call.

### Event Section Layout

```
♥ PAGE UPDATE (0:00)                     <- event header (clickable -> seek)
  61 nodes added, 0 text changes         <- DOM summary
  ┌ GET /documentation       200  46ms   <- correlated call (clickable -> detail)
  └ GET /v1/environment      200  43ms
  ♦ 3 background calls       ▸           <- collapsed sub-group

♥ CLICK (0:06)
  93 nodes added, 0 text changes
  ┌ GET /api/users           200  46ms
  ♦ 1 background call        ▸
```

### Event Section Header

- Format: `♥ {TYPE} ({m:ss})` where TYPE is CLICK / INPUT / SCROLL / PAGE UPDATE and m:ss is replay-relative timestamp
- Clickable: seeks replay to `event.timestamp - 200ms` (so user sees the page state just before the mutation, then watches it happen)
- Receives NOW badge during playback when the replay time falls within the event's window
- Auto-scroll during playback tracks the active event section

### Correlated API Calls

- Full-color styling: status-colored left border, colored duration bar
- Clicking a row opens the detail panel (request/response headers, body)
- No info icon needed — the entire row is the detail trigger
- Title format: `METHOD /path   STATUS   duration`

### Background Calls Sub-Group

- Grouped into a collapsed `♦ N background calls` sub-group within the event section
- Visually muted: gray border, dimmed duration bar, reduced opacity
- Expandable on click, same pattern as current
- When expanded, individual entries are clickable to open detail panel
- Never highlighted during playback

### Event Sections Are Chronologically Ordered

All event sections are sorted by `timestamp` ascending. Within each section, correlated calls come first (sorted by start time), then the background calls sub-group.

## 3. Scrubber

The scrubber operates at the **event level**, not the request level.

### Event Ticks

- **One tick per event section** positioned at `(event.timestamp - sessionStart) / totalDuration * 100%`
- All ticks use the same accent color (the existing marker color scheme)
- No ticks for individual API calls — only event-level ticks
- Active tick gets a glow/highlight during playback

### Click Behavior

- Clicking a tick seeks replay to `event.timestamp - 200ms` and highlights the corresponding event section in the API panel
- **Overlapping ticks** (events within ~1% of scrubber width): show a mini picker popover listing the events by label ("PAGE UPDATE", "CLICK", etc.). User selects one from the popover.

### Bidirectional Sync

- Click event header in panel -> seek replay + highlight scrubber tick
- Click scrubber tick -> seek replay + scroll panel to event section + highlight it
- During playback -> active event section gets NOW badge, scrubber tick glows, panel auto-scrolls

## 4. Detail Panel

Unchanged from current behavior. Clicking an individual API call row (correlated or background, when expanded) opens the detail panel showing request/response headers, body, timing.

The only change: remove the info icon from `TimelineEntry` since the entire row is now the click target for opening details.

## 5. Files to Change

| File                      | Change                                                                                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `replay-store.ts`         | Add `EventSection` type and `eventSections: EventSection[]` to `ReplayState`. Add `buildEventSections()` pure function. Add `setActiveEventId()` action.      |
| `App.svelte`              | Call `buildEventSections()` after loading session data, store result.                                                                                         |
| `Timeline.svelte`         | Rewrite `buildGroups` to map over `eventSections`. Each section becomes an `EventGroup` component. Remove current `DisplayGroup`/`CorrelationGroup` approach. |
| `CorrelationGroup.svelte` | Rename to `EventGroup.svelte`. Renders event header, DOM summary, correlated call list, collapsed background sub-group.                                       |
| `TimelineEntry.svelte`    | Remove info icon. Make entire row clickable for detail panel. Keep `muted` prop for background call styling.                                                  |
| `Scrubber.svelte`         | Replace per-request markers with per-event ticks. Add click handler with mini picker for overlapping ticks. Add active tick glow.                             |
| `group-naming.ts`         | Add `eventTypeLabel(type)` function. Keep `formatGroupTimestamp` for time formatting. Remove bundle-specific naming functions that are no longer needed.      |
| `group-naming.test.ts`    | Update tests for new naming functions.                                                                                                                        |

## 6. Edge Cases

- **Zero UI interactions**: All bundles become "PAGE UPDATE" events. Typical for initial page load sessions.
- **UI interaction with no following API calls or DOM mutations**: Omit the event section entirely. A click that does nothing visible isn't useful in the timeline.
- **Session with no bundles**: All requests are background calls, attached to UI interaction events (or a single "PAGE UPDATE" if no interactions). The event sections show "0 nodes added, 0 text changes" with only background calls.
- **Rapid-fire interactions**: Deduplicated at 200ms (same type). Different types within 200ms create separate events (e.g., a click at T=100 and an input at T=150 are separate).
- **Overlapping scrubber ticks**: Events within 1% of total duration width trigger the mini picker popover.
