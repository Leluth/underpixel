# Timeline Panel Redesign

Improves the replay timeline panel's information hierarchy, ordering, and interaction model. Addresses three issues: duplicate group names are ambiguous, uncorrelated calls have no clear role, and groups aren't sorted chronologically.

## 1. Timestamp Suffix for Duplicate Group Names

When multiple bundles produce the same display name (e.g., three `GET /api/users` calls all named "USERS"), every instance gets a replay-relative timestamp suffix.

**Format:** `NAME (m:ss)` where the time is `bundle.timestamp - session.startTime`.

```
♥ USERS (0:01)
♥ USERS (0:12)
♥ USERS (0:45)
```

All instances get the suffix — including the first — for visual consistency. The suffix reuses the `formatDuration` helper already in `replay/lib/format.ts`.

## 2. Chronological Interleaving with Batched Uncorrelated Groups

All entries are sorted by timestamp into a single chronological timeline. Uncorrelated requests that fall between two bundles are batched into a single collapsed group at that position.

**Example session:**

```
♥ USERS (0:01)           ← bundle, expanded
♦ 2 other calls          ← uncorrelated batch, collapsed
♥ LOGIN (0:06)           ← bundle, expanded
♥ PROFILE (0:10)         ← bundle, expanded
♦ 3 other calls          ← uncorrelated batch, collapsed
```

**Batching algorithm** (`buildGroups` in `Timeline.svelte`):

1. Sort all bundles by `bundle.timestamp` ascending.
2. Build a set of request IDs claimed by bundles (`usedIds`).
3. Collect uncorrelated requests: those not in `usedIds`, sorted by `startTime`.
4. Walk through bundles in order. Before each bundle (and after the last), collect any uncorrelated requests whose `startTime` falls in the gap between the previous bundle's timestamp and the current bundle's timestamp.
5. Emit each batch as a single `DisplayGroup` with `bundle: null` and `name: '{n} other call(s)'`.

The batch's sort key is the `startTime` of its earliest request.

Trailing uncorrelated calls (after the last bundle) form a final batch at the end.

## 3. Uncorrelated Group Behavior

**Collapsed by default.** The group header shows the count (e.g., "♦ 3 other calls") and is clickable to expand/collapse.

**Visually de-prioritized.** Muted styling when collapsed and expanded:

- Group header: `var(--text-muted)` color instead of `var(--text-dim)`
- No active border highlight, no orange glow
- When expanded, entries use the same `TimelineEntry` component but with a muted border-left color (`var(--text-muted)` instead of status-based color)

**Clickable when expanded.** Clicking an individual entry inside an expanded uncorrelated group:

- Seeks the replay player to `request.startTime - session.startTime`
- Opens the detail panel for that request
- Same `selectCall()` + seek behavior as bundled entries

**Never auto-highlighted during playback.** During play:

- Uncorrelated groups never receive the `active` class
- No NOW badge appears on uncorrelated groups
- No `isInProgress` outline on uncorrelated entries
- The `activeGroupId` computation skips groups where `bundle === null`
- The auto-scroll logic skips uncorrelated groups

This means during playback the timeline highlights jump from bundle to bundle, skipping over the muted uncorrelated batches.

## 4. Bundled Group Behavior (Unchanged)

- Full-color styling, active orange border during playback
- NOW badge when the replay time falls within the bundle's window
- Clickable entries seek replay and open detail panel
- Auto-scroll during playback tracks active bundled group

## 5. Files to Change

| File                      | Change                                                                                                                                                                                                                                        |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `group-naming.ts`         | Add `formatGroupName(name, timestampMs, sessionStartMs)` that appends `(m:ss)` suffix. Keep `generateGroupName` for raw name extraction.                                                                                                      |
| `group-naming.test.ts`    | Add tests for timestamp suffix formatting, duplicate names, edge cases.                                                                                                                                                                       |
| `Timeline.svelte`         | Rewrite `buildGroups`: sort bundles chronologically, batch uncorrelated requests between bundles, emit interleaved `DisplayGroup[]`. Update `activeGroupId` to skip `bundle === null` groups. Update auto-scroll to skip uncorrelated groups. |
| `CorrelationGroup.svelte` | Add `collapsed` prop (default `true` for uncorrelated, `false` for bundled). Add expand/collapse toggle on header click. Add `muted` variant CSS class for de-prioritized styling.                                                            |
| `TimelineEntry.svelte`    | Add replay seek on click for uncorrelated entries (already works for bundled via `selectCall`).                                                                                                                                               |
| `replay-store.ts`         | Add `seekTo(timeMs)` action if not already exposed, for uncorrelated entry clicks.                                                                                                                                                            |

## 6. DisplayGroup Interface Update

```typescript
interface DisplayGroup {
  bundle: CorrelationBundle | null;
  name: string; // "USERS (0:01)" or "3 other calls"
  symbol: string; // ♥ ★ for bundles, ♦ for uncorrelated
  requests: NetworkRequest[];
  correlationNote: string;
  defaultCollapsed: boolean; // NEW: initial state — true for uncorrelated, false for bundled
  // CorrelationGroup manages its own reactive expand/collapse internally
}
```

## 7. Edge Cases

- **Zero bundles:** All requests become a single uncorrelated batch. Starts collapsed. Header: "♦ {n} other calls".
- **Zero uncorrelated requests:** No uncorrelated batches appear. Timeline is just bundles.
- **Single request in uncorrelated batch:** Header says "1 other call" (singular).
- **Filters active:** Batching runs after filtering. An uncorrelated batch that filters to 0 requests is omitted entirely.
- **Session with no startTime:** Fall back to `0` for timestamp calculations (defensive).
