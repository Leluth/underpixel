<script lang="ts">
  import type { NetworkRequest } from 'underpixel-shared';
  import TimelineEntry from './TimelineEntry.svelte';

  export let name: string;
  export let symbol: string;
  export let requests: NetworkRequest[];
  export let isActive: boolean = false;
  export let correlationNote: string = '';
  export let muted: boolean = false;

  /** Track whether the user has explicitly expanded this muted group */
  let userExpanded = false;

  function toggleCollapse() {
    userExpanded = !userExpanded;
  }

  $: showEntries = !muted || userExpanded;
</script>

<div class="group" class:active={isActive && !muted} class:muted>
  <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-noninteractive-tabindex -->
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
      <span class="collapse-indicator">{userExpanded ? '▾' : '▸'}</span>
    {/if}
  </div>
  {#if showEntries}
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

<style>
  .group {
    padding: 4px 8px;
    margin: 2px 4px;
    border-radius: 4px;
    border: 2px solid transparent;
    transition: border-color 0.2s, background 0.2s;
  }

  .group.active {
    border-color: var(--warning);
    background: rgba(255, 204, 128, 0.05);
  }

  .group-header {
    font-family: var(--font-pixel);
    font-size: 7px;
    color: var(--text-dim);
    padding: 6px 4px 4px;
    letter-spacing: 1px;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .group.active .group-header {
    color: var(--warning);
  }

  .group-symbol {
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

  .correlation-note {
    font-family: var(--font-body);
    font-size: 13px;
    color: var(--warning);
    padding: 2px 10px 4px;
  }

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
</style>
