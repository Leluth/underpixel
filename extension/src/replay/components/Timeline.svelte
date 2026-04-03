<script lang="ts">
  import { replayStore, findActiveEvent } from '../stores/replay-store';
  import EventGroup from './EventGroup.svelte';
  import SearchBar from './SearchBar.svelte';
  import { matchesFilters, matchesSearch } from '../lib/search';
  import type { EventSection } from '../lib/event-sections';

  export let onSeek: (timeMs: number) => void = () => {};

  let scrollContainer: HTMLDivElement;

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

  $: eventCount = visibleSections.length;
  // Derive call counts from visibleSections (derived from eventSections,
  // avoids reading $replayStore directly which would fire at 60Hz)
  $: totalCalls = visibleSections.reduce(
    (sum, s) => sum + s.correlatedRequests.length + s.backgroundRequests.length, 0,
  );
  $: errorCount = visibleSections.reduce((sum, s) => {
    const errors = [...s.correlatedRequests, ...s.backgroundRequests]
      .filter((r) => r.statusCode && r.statusCode >= 400);
    return sum + errors.length;
  }, 0);

  function filterSections(
    sections: EventSection[],
    searchQuery: string,
    filters: import('../lib/search').FilterState,
  ): EventSection[] {
    if (!searchQuery && Object.values(filters).every((v) => !v)) return sections;

    return sections.filter((s) => {
      const allRequests = [...s.correlatedRequests, ...s.backgroundRequests];
      return allRequests.some(
        (r) => matchesFilters(r, filters) && matchesSearch(r, searchQuery),
      );
    });
  }

  function handleSeek(eventTimestamp: number) {
    const offset = eventTimestamp - sessionStart - 200;
    onSeek(Math.max(0, offset));
  }

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
          correlatedRequests={section.correlatedRequests}
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
