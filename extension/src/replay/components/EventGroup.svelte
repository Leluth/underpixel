<script lang="ts">
  import type { NetworkRequest } from 'underpixel-shared';
  import { openDetail } from '../stores/replay-store';
  import TimelineEntry from './TimelineEntry.svelte';
  import { formatGroupTimestamp } from '../lib/group-naming';

  export let id: string;
  export let label: string;
  export let timestamp: number;
  export let sessionStart: number;
  export let correlatedRequests: NetworkRequest[];
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

  {#if correlatedRequests.length > 0}
    <div class="dom-summary">{summaryText}</div>
  {/if}

  <div class="correlated-entries">
    {#each correlatedRequests as request (request.requestId)}
      <TimelineEntry {request} />
    {/each}
  </div>

  {#if backgroundRequests.length > 0}
    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-noninteractive-tabindex -->
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
          <TimelineEntry {request} muted />
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
