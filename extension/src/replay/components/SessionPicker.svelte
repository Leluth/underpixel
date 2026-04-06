<script lang="ts">
  import { sessions, sessionsLoading } from '../stores/session-store';
  import { createEventDispatcher } from 'svelte';
  import { hostnameFromUrl, formatSessionDuration } from '../lib/format';

  export let selectedSessionId = '';

  const dispatch = createEventDispatcher<{ select: string }>();

  function handleChange(e: Event) {
    const target = e.target as HTMLSelectElement;
    if (target.value) {
      dispatch('select', target.value);
    }
  }

  function formatDate(ts: number): string {
    return new Date(ts).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }
</script>

<div class="session-picker">
  {#if $sessionsLoading}
    <span class="loading-label">Loading...</span>
  {:else}
    <select on:change={handleChange} value={selectedSessionId}>
      <option value="" disabled>Select session</option>
      {#each $sessions as session}
        <option value={session.id}>
          {session.imported ? '▸' : '♦'} {hostnameFromUrl(session.initialUrl)} ({formatSessionDuration(session.startTime, session.endTime)}) —
          {formatDate(session.startTime)}{session.imported ? ' [Imported]' : ''}
        </option>
      {/each}
    </select>
  {/if}
</div>

<style>
  .session-picker {
    display: flex;
    align-items: center;
  }

  select {
    font-family: var(--font-ui);
    font-size: 11px;
    color: var(--text-primary);
    background: var(--base-bg);
    border: var(--border-width) solid var(--border);
    padding: 3px 10px;
    min-width: 200px;
    cursor: pointer;
  }

  select:focus {
    border-color: var(--accent);
    outline: none;
  }

  .loading-label {
    font-family: var(--font-ui);
    font-size: 11px;
    color: var(--text-dim);
  }
</style>
