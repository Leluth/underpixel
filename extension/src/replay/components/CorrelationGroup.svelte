<script lang="ts">
  import type { NetworkRequest } from 'underpixel-shared';
  import TimelineEntry from './TimelineEntry.svelte';

  export let name: string;
  export let symbol: string;
  export let requests: NetworkRequest[];
  export let isActive: boolean = false;
  export let correlationNote: string = '';
</script>

<div class="group" class:active={isActive}>
  <div class="group-header">
    <span class="group-symbol">{symbol}</span>
    <span class="group-name">{name}</span>
    {#if isActive}
      <span class="now-badge">NOW</span>
    {/if}
  </div>
  <div class="group-entries">
    {#each requests as request (request.requestId)}
      <TimelineEntry {request} />
    {/each}
  </div>
  {#if correlationNote}
    <div class="correlation-note">♦ {correlationNote}</div>
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
</style>
