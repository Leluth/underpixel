<script lang="ts">
  import { replayStore, findActiveGroup } from '../stores/replay-store';
  import { matchesFilters, matchesSearch } from '../lib/search';
  import {
    generateGroupName,
    generateGroupSymbol,
    formatGroupLabel,
  } from '../lib/group-naming';
  import CorrelationGroup from './CorrelationGroup.svelte';
  import SearchBar from './SearchBar.svelte';
  import type { NetworkRequest, CorrelationBundle } from 'underpixel-shared';
  import type { FilterState } from '../lib/search';

  interface DisplayGroup {
    bundle: CorrelationBundle | null;
    name: string;
    symbol: string;
    requests: NetworkRequest[];
    correlationNote: string;
  }

  let scrollContainer: HTMLDivElement;

  $: groups = buildGroups(
    $replayStore.allRequests,
    $replayStore.bundles,
    $replayStore.searchQuery,
    $replayStore.filters,
    $replayStore.session?.startTime ?? 0,
  );

  // Determine active group: prefer the group containing the selected call,
  // fall back to time-based during playback
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
      $replayStore.session
        ? $replayStore.currentTime + $replayStore.session.startTime
        : 0,
    );
    return bundle?.id ?? null;
  })();

  $: filteredCount = groups.reduce((sum, g) => sum + g.requests.length, 0);
  $: totalCount = $replayStore.allRequests.length;
  $: errorCount = $replayStore.allRequests.filter(
    (r) => r.statusCode && r.statusCode >= 400,
  ).length;

  function makeBackgroundGroup(requests: NetworkRequest[]): DisplayGroup {
    return {
      bundle: null,
      name: requests.length === 1 ? '1 background call' : `${requests.length} background calls`,
      symbol: '♦',
      requests,
      correlationNote: '',
    };
  }

  function buildGroups(
    requests: NetworkRequest[],
    bundles: CorrelationBundle[],
    searchQuery: string,
    filters: FilterState,
    sessionStart: number,
  ): DisplayGroup[] {
    const filtered = requests.filter(
      (r) => matchesFilters(r, filters) && matchesSearch(r, searchQuery),
    );
    const filteredIds = new Set(filtered.map((r) => r.requestId));
    const requestMap = new Map(requests.map((r) => [r.requestId, r]));

    const sortedBundles = [...bundles].sort((a, b) => a.timestamp - b.timestamp);
    const usedIds = new Set<string>();
    const bundleGroups: { group: DisplayGroup; timestamp: number }[] = [];

    for (const bundle of sortedBundles) {
      const bundleRequests = bundle.apiCalls
        .map((id) => requestMap.get(id))
        .filter(
          (r): r is NetworkRequest =>
            r !== undefined && filteredIds.has(r.requestId),
        );

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
        },
        timestamp: bundle.timestamp,
      });
    }

    const uncorrelated = filtered
      .filter((r) => !usedIds.has(r.requestId))
      .sort((a, b) => a.startTime - b.startTime);

    // Interleave: batch uncorrelated requests between bundles chronologically
    const result: DisplayGroup[] = [];
    let uncorIdx = 0;

    for (const { group, timestamp } of bundleGroups) {
      const batch: NetworkRequest[] = [];
      while (uncorIdx < uncorrelated.length && uncorrelated[uncorIdx].startTime < timestamp) {
        batch.push(uncorrelated[uncorIdx]);
        uncorIdx++;
      }
      if (batch.length > 0) result.push(makeBackgroundGroup(batch));
      result.push(group);
    }

    const trailing = uncorrelated.slice(uncorIdx);
    if (trailing.length > 0) result.push(makeBackgroundGroup(trailing));

    return result;
  }

  // Only auto-scroll to active group during playback, not on manual clicks
  // This prevents hijacking the user's scroll position
  let lastAutoScrollGroupId: string | null = null;
  $: if ($replayStore.isPlaying && activeGroupId && activeGroupId !== lastAutoScrollGroupId && scrollContainer) {
    lastAutoScrollGroupId = activeGroupId;
    const activeIdx = groups.findIndex(
      (g) => g.bundle !== null && g.bundle.id === activeGroupId,
    );
    if (activeIdx >= 0) {
      const groupEls = scrollContainer.querySelectorAll('.group-wrapper');
      groupEls[activeIdx]?.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth',
      });
    }
  }
</script>

<div class="timeline">
  <SearchBar />

  <div class="timeline-scroll" bind:this={scrollContainer}>
    {#each groups as group, i (group.bundle?.id ?? `uncorrelated-${i}`)}
      <div class="group-wrapper">
        <CorrelationGroup
          name={group.name}
          symbol={group.symbol}
          requests={group.requests}
          isActive={group.bundle !== null && activeGroupId === group.bundle.id}
          correlationNote={group.correlationNote}
          muted={group.bundle === null}
        />
      </div>
    {/each}

    {#if groups.length === 0}
      <div class="empty-timeline">
        <span class="empty-text">No API calls</span>
      </div>
    {/if}
  </div>

  <div class="summary-bar">
    <span
      >{filteredCount}{filteredCount !== totalCount
        ? `/${totalCount}`
        : ''} calls</span
    >
    <span>{$replayStore.bundles.length} correlations</span>
    {#if errorCount > 0}
      <span class="error-count"
        >{errorCount} error{errorCount > 1 ? 's' : ''}</span
      >
    {/if}
  </div>
</div>

<style>
  .timeline {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--base-bg);
  }

  .timeline-scroll {
    flex: 1;
    overflow-y: auto;
    padding: 6px 0;
  }

  .empty-timeline {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
  }

  .empty-text {
    font-family: var(--font-body);
    font-size: 16px;
    color: var(--text-dim);
  }

  .summary-bar {
    padding: 6px 12px;
    background: var(--surface);
    border-top: var(--border-width) solid var(--border);
    display: flex;
    justify-content: space-between;
    font-family: var(--font-body);
    font-size: 14px;
    color: var(--text-secondary);
  }

  .error-count {
    color: var(--error);
  }
</style>
