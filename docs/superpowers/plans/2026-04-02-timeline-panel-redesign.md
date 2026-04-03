# Timeline Panel Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the replay timeline panel so groups are chronologically ordered, duplicate names are disambiguated with timestamps, and uncorrelated API calls are batched into collapsed/muted groups between bundles.

**Architecture:** Pure logic changes in `group-naming.ts` (timestamp suffix formatter), a rewritten `buildGroups` in `Timeline.svelte` (chronological sort + batching), and UI changes in `CorrelationGroup.svelte` (collapse/expand + muted variant). The existing seek mechanism (`selectCall` → Player subscription → `player.goto`) already works for all entries — no store changes needed.

**Tech Stack:** Svelte 5 (legacy Svelte 4 syntax), TypeScript, Vitest

**Spec:** `docs/superpowers/specs/2026-04-02-timeline-panel-redesign.md`

---

### File Map

| File                                                      | Action | Responsibility                                                                                                                                                |
| --------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `extension/src/replay/lib/group-naming.ts`                | Modify | Add `formatGroupTimestamp` helper, add `formatGroupLabel` that appends `(m:ss)` suffix                                                                        |
| `extension/src/replay/lib/group-naming.test.ts`           | Modify | Tests for new functions                                                                                                                                       |
| `extension/src/replay/components/Timeline.svelte`         | Modify | Rewrite `buildGroups` for chronological sort + batching. Update `activeGroupId` and auto-scroll to skip uncorrelated groups. Update `DisplayGroup` interface. |
| `extension/src/replay/components/CorrelationGroup.svelte` | Modify | Add `defaultCollapsed` prop, internal collapse/expand toggle, `muted` CSS variant                                                                             |
| `extension/src/replay/components/TimelineEntry.svelte`    | Modify | Add `muted` prop for de-prioritized border color, suppress `isInProgress` outline when muted                                                                  |

---

### Task 1: Add timestamp formatting to group-naming

**Files:**

- Modify: `extension/src/replay/lib/group-naming.ts`
- Modify: `extension/src/replay/lib/group-naming.test.ts`

- [ ] **Step 1: Write failing tests for `formatGroupTimestamp`**

Add to `group-naming.test.ts`:

```typescript
import {
  generateGroupName,
  generateGroupSymbol,
  formatGroupTimestamp,
  formatGroupLabel,
} from './group-naming';

// ... existing tests ...

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
});

describe('formatGroupLabel', () => {
  it('appends timestamp suffix to name', () => {
    expect(formatGroupLabel('USERS', 1500, 0)).toBe('USERS (0:01)');
  });
  it('computes offset from session start', () => {
    expect(formatGroupLabel('LOGIN', 1000065000, 1000000000)).toBe('LOGIN (1:05)');
  });
  it('handles zero session start', () => {
    expect(formatGroupLabel('PROFILE', 12000, 0)).toBe('PROFILE (0:12)');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /c/Projects/web-tool/underpixel && pnpm -F extension test -- --run lib/correlation group-naming`

Expected: FAIL — `formatGroupTimestamp` and `formatGroupLabel` not exported.

- [ ] **Step 3: Implement `formatGroupTimestamp` and `formatGroupLabel`**

Add to `group-naming.ts` (after existing functions):

```typescript
/** Format a ms offset as m:ss for group header display */
export function formatGroupTimestamp(offsetMs: number): string {
  const totalSeconds = Math.floor(Math.max(0, offsetMs) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** Build the full display label: "NAME (m:ss)" */
export function formatGroupLabel(
  name: string,
  bundleTimestamp: number,
  sessionStartTime: number,
): string {
  const offset = bundleTimestamp - sessionStartTime;
  return `${name} (${formatGroupTimestamp(offset)})`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /c/Projects/web-tool/underpixel && pnpm -F extension test -- --run`

Expected: All tests PASS.

- [ ] **Step 5: Run lint**

Run: `cd /c/Projects/web-tool/underpixel && pnpm lint`

Expected: Clean.

---

### Task 2: Rewrite `buildGroups` in Timeline.svelte

**Files:**

- Modify: `extension/src/replay/components/Timeline.svelte`

- [ ] **Step 1: Update the `DisplayGroup` interface**

In `Timeline.svelte`, replace the existing `DisplayGroup` interface (lines 13-19) with:

```typescript
interface DisplayGroup {
  bundle: CorrelationBundle | null;
  name: string;
  symbol: string;
  requests: NetworkRequest[];
  correlationNote: string;
  defaultCollapsed: boolean;
}
```

- [ ] **Step 2: Add imports for new group-naming functions**

Update the import statement (lines 4-7) to:

```typescript
import { generateGroupName, generateGroupSymbol, formatGroupLabel } from '../lib/group-naming';
```

- [ ] **Step 3: Rewrite `buildGroups` function**

Replace the existing `buildGroups` function (lines 57-106) with:

```typescript
function buildGroups(
  requests: NetworkRequest[],
  bundles: CorrelationBundle[],
  searchQuery: string,
  filters: FilterState,
): DisplayGroup[] {
  const sessionStart = $replayStore.session?.startTime ?? 0;

  const filtered = requests.filter(
    (r) => matchesFilters(r, filters) && matchesSearch(r, searchQuery),
  );
  const filteredIds = new Set(filtered.map((r) => r.requestId));
  const requestMap = new Map(requests.map((r) => [r.requestId, r]));

  // Build bundle groups sorted chronologically
  const sortedBundles = [...bundles].sort((a, b) => a.timestamp - b.timestamp);
  const usedIds = new Set<string>();
  const bundleGroups: { group: DisplayGroup; timestamp: number }[] = [];

  for (const bundle of sortedBundles) {
    const bundleRequests = bundle.apiCalls
      .map((id) => requestMap.get(id))
      .filter((r): r is NetworkRequest => r !== undefined && filteredIds.has(r.requestId));

    if (bundleRequests.length === 0) continue;

    bundleRequests.forEach((r) => usedIds.add(r.requestId));

    const rawName = generateGroupName(bundle.trigger);
    const name = formatGroupLabel(rawName, bundle.timestamp, sessionStart);
    bundleGroups.push({
      group: {
        bundle,
        name,
        symbol: generateGroupSymbol(rawName),
        requests: bundleRequests,
        correlationNote: bundle.correlation || '',
        defaultCollapsed: false,
      },
      timestamp: bundle.timestamp,
    });
  }

  // Collect uncorrelated requests sorted by startTime
  const uncorrelated = filtered
    .filter((r) => !usedIds.has(r.requestId))
    .sort((a, b) => a.startTime - b.startTime);

  // Interleave: batch uncorrelated requests between bundles
  const result: DisplayGroup[] = [];
  let uncorIdx = 0;

  for (const { group, timestamp } of bundleGroups) {
    // Collect uncorrelated requests before this bundle
    const batch: NetworkRequest[] = [];
    while (uncorIdx < uncorrelated.length && uncorrelated[uncorIdx].startTime < timestamp) {
      batch.push(uncorrelated[uncorIdx]);
      uncorIdx++;
    }
    if (batch.length > 0) {
      result.push({
        bundle: null,
        name: batch.length === 1 ? '1 other call' : `${batch.length} other calls`,
        symbol: '♦',
        requests: batch,
        correlationNote: '',
        defaultCollapsed: true,
      });
    }
    result.push(group);
  }

  // Trailing uncorrelated requests after last bundle
  const trailing = uncorrelated.slice(uncorIdx);
  if (trailing.length > 0) {
    result.push({
      bundle: null,
      name: trailing.length === 1 ? '1 other call' : `${trailing.length} other calls`,
      symbol: '♦',
      requests: trailing,
      correlationNote: '',
      defaultCollapsed: true,
    });
  }

  return result;
}
```

- [ ] **Step 4: Update `activeGroupId` to skip uncorrelated groups**

Replace the existing `activeGroupId` reactive block (lines 32-49) with:

```typescript
$: activeGroupId = (() => {
  // If a call is selected, find which BUNDLED group contains it
  const selectedId = $replayStore.selectedCallId;
  if (selectedId) {
    const group = groups.find(
      (g) => g.bundle !== null && g.requests.some((r) => r.requestId === selectedId),
    );
    if (group) return group.bundle?.id ?? null;
  }
  // Fall back to time-based (bundles only)
  const bundle = findActiveGroup(
    $replayStore.bundles,
    $replayStore.session ? $replayStore.currentTime + $replayStore.session.startTime : 0,
  );
  return bundle?.id ?? null;
})();
```

- [ ] **Step 5: Update auto-scroll to skip uncorrelated groups**

Replace the existing auto-scroll reactive block (lines 110-123) with:

```typescript
$: if (
  $replayStore.isPlaying &&
  activeGroupId &&
  activeGroupId !== lastAutoScrollGroupId &&
  scrollContainer
) {
  lastAutoScrollGroupId = activeGroupId;
  const activeIdx = groups.findIndex((g) => g.bundle !== null && g.bundle.id === activeGroupId);
  if (activeIdx >= 0) {
    const groupEls = scrollContainer.querySelectorAll('.group-wrapper');
    groupEls[activeIdx]?.scrollIntoView({
      block: 'nearest',
      behavior: 'smooth',
    });
  }
}
```

- [ ] **Step 6: Update the template to pass `defaultCollapsed`**

Replace the `<CorrelationGroup>` usage in the template (lines 132-138) with:

```svelte
<CorrelationGroup
  name={group.name}
  symbol={group.symbol}
  requests={group.requests}
  isActive={activeGroupId === (group.bundle?.id ?? null)}
  correlationNote={group.correlationNote}
  defaultCollapsed={group.defaultCollapsed}
  muted={group.bundle === null}
/>
```

- [ ] **Step 7: Run lint and verify no errors**

Run: `cd /c/Projects/web-tool/underpixel && pnpm lint`

Expected: Clean.

---

### Task 3: Add collapse/expand and muted variant to CorrelationGroup

**Files:**

- Modify: `extension/src/replay/components/CorrelationGroup.svelte`

- [ ] **Step 1: Add new props and internal collapse state**

Replace the existing `<script>` block (lines 1-10) with:

```svelte
<script lang="ts">
  import type { NetworkRequest } from 'underpixel-shared';
  import TimelineEntry from './TimelineEntry.svelte';

  export let name: string;
  export let symbol: string;
  export let requests: NetworkRequest[];
  export let isActive: boolean = false;
  export let correlationNote: string = '';
  export let defaultCollapsed: boolean = false;
  export let muted: boolean = false;

  let collapsed = defaultCollapsed;

  function toggleCollapse() {
    collapsed = !collapsed;
  }
</script>
```

- [ ] **Step 2: Update the template for collapse/expand and muted styling**

Replace the entire template section (lines 12-28) with:

```svelte
<div class="group" class:active={isActive && !muted} class:muted>
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <div
    class="group-header"
    class:collapsible={muted}
    on:click={muted ? toggleCollapse : undefined}
    role={muted ? 'button' : undefined}
    tabindex={muted ? 0 : undefined}
  >
    <span class="group-symbol">{symbol}</span>
    <span class="group-name">{name}</span>
    {#if isActive && !muted}
      <span class="now-badge">NOW</span>
    {/if}
    {#if muted}
      <span class="collapse-indicator">{collapsed ? '▸' : '▾'}</span>
    {/if}
  </div>
  {#if !collapsed}
    <div class="group-entries">
      {#each requests as request (request.requestId)}
        <TimelineEntry {request} {muted} />
      {/each}
    </div>
    {#if correlationNote}
      <div class="correlation-note">♦ {correlationNote}</div>
    {/if}
  {/if}
</div>
```

- [ ] **Step 3: Add muted CSS styles**

Add the following styles to the existing `<style>` block, after the `.correlation-note` rule:

```css
.group.muted {
  border-color: transparent;
}

.group.muted .group-header {
  color: var(--text-muted);
  cursor: pointer;
}

.group.muted .group-header:hover {
  color: var(--text-secondary);
}

.collapsible {
  user-select: none;
}

.collapse-indicator {
  font-size: 10px;
  margin-left: auto;
  color: var(--text-muted);
}
```

- [ ] **Step 4: Run lint**

Run: `cd /c/Projects/web-tool/underpixel && pnpm lint`

Expected: Clean.

---

### Task 4: Add muted variant to TimelineEntry

**Files:**

- Modify: `extension/src/replay/components/TimelineEntry.svelte`

- [ ] **Step 1: Add `muted` prop**

After the existing `export let request: NetworkRequest;` line (line 7), add:

```typescript
export let muted: boolean = false;
```

- [ ] **Step 2: Suppress `isInProgress` for muted entries**

Replace the existing `isInProgress` reactive declaration (lines 10-15) with:

```typescript
$: isInProgress =
  !muted &&
  $replayStore.session &&
  request.startTime <= $replayStore.currentTime + $replayStore.session.startTime &&
  (request.endTime ?? request.startTime) >=
    $replayStore.currentTime + $replayStore.session.startTime;
```

- [ ] **Step 3: Apply muted border color**

Update the `style` attribute on the `.entry` div (line 39) to:

```svelte
style="border-left-color: {muted ? 'var(--text-muted)' : statusColor(request.statusCode)}"
```

- [ ] **Step 4: Run all tests and lint**

Run: `cd /c/Projects/web-tool/underpixel && pnpm lint && pnpm test`

Expected: All tests pass, lint clean.

---

### Task 5: Verify end-to-end and fix any issues

**Files:**

- All modified files from Tasks 1-4

- [ ] **Step 1: Run full test suite**

Run: `cd /c/Projects/web-tool/underpixel && pnpm test`

Expected: All tests pass (shared: 19, bridge: 12, extension: all pass including new group-naming tests).

- [ ] **Step 2: Run lint**

Run: `cd /c/Projects/web-tool/underpixel && pnpm lint`

Expected: Clean.

- [ ] **Step 3: Run build**

Run: `cd /c/Projects/web-tool/underpixel && pnpm build`

Expected: Successful build with no TypeScript errors.

- [ ] **Step 4: Verify spec coverage**

Cross-check against spec:

| Spec requirement                               | Task                                                                         |
| ---------------------------------------------- | ---------------------------------------------------------------------------- |
| Timestamp suffix `(m:ss)` on all bundle groups | Task 1 (formatter) + Task 2 (buildGroups applies it)                         |
| Chronological interleaving                     | Task 2 (sort + interleave in buildGroups)                                    |
| Batched uncorrelated groups between bundles    | Task 2 (batching loop in buildGroups)                                        |
| Collapsed by default                           | Task 3 (defaultCollapsed prop)                                               |
| Visually de-prioritized                        | Task 3 (muted CSS) + Task 4 (muted border)                                   |
| Clickable to seek when expanded                | Already works — selectCall triggers Player seek                              |
| Never auto-highlighted during playback         | Task 2 (activeGroupId skips null bundles) + Task 4 (isInProgress suppressed) |
| Auto-scroll skips uncorrelated                 | Task 2 (auto-scroll checks bundle !== null)                                  |
| Edge: singular "1 other call"                  | Task 2 (ternary in batching)                                                 |
| Edge: zero bundles → single batch              | Task 2 (trailing batch handles this)                                         |
| Edge: zero uncorrelated → no batches           | Task 2 (batch only emitted if length > 0)                                    |
