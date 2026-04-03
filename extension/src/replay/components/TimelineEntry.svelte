<script lang="ts">
  import type { NetworkRequest } from 'underpixel-shared';
  import { replayStore, selectCall, openDetail } from '../stores/replay-store';
  import { formatDuration, shortenUrl } from '../lib/format';
  import { statusColor, methodColor } from '../lib/theme';

  export let request: NetworkRequest;

  $: isSelected = $replayStore.selectedCallId === request.requestId;
  $: isInProgress =
    $replayStore.session &&
    request.startTime <=
      $replayStore.currentTime + $replayStore.session.startTime &&
    (request.endTime ?? request.startTime) >=
      $replayStore.currentTime + $replayStore.session.startTime;

  $: durationPercent = request.duration
    ? Math.min((request.duration / 3000) * 100, 100)
    : 0;

  function handleClick() {
    selectCall(request.requestId);
  }

  function handleDetailClick(e: MouseEvent) {
    e.stopPropagation();
    openDetail(request.requestId);
  }
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<div
  class="entry"
  class:selected={isSelected}
  class:in-progress={isInProgress}
  on:click={handleClick}
  role="button"
  tabindex="0"
  style="border-left-color: {statusColor(request.statusCode)}"
>
  <div class="entry-header">
    <div class="method-url">
      <span class="method" style="color: {methodColor(request.method)}"
        >{request.method}</span
      >
      <span class="url">{shortenUrl(request.url)}</span>
    </div>
    <div class="entry-actions">
      <span class="status" style="color: {statusColor(request.statusCode)}">
        {request.statusCode ?? '...'}
      </span>
      <button class="detail-btn" on:click={handleDetailClick} title="View details">
        ⓘ
      </button>
    </div>
  </div>
  <div class="entry-timing">
    <div class="duration-track">
      <div
        class="duration-bar"
        style="width: {durationPercent}%; background: {statusColor(request.statusCode)}"
      ></div>
    </div>
    <span class="duration-text">{formatDuration(request.duration)}</span>
  </div>
  {#if request.errorText}
    <div class="error-note">✗ {request.errorText}</div>
  {/if}
</div>

<style>
  .entry {
    background: var(--surface);
    margin: 3px 0;
    padding: 8px 10px;
    border-left: 4px solid var(--text-dim);
    border-radius: 0 4px 4px 0;
    cursor: pointer;
    transition: background 0.1s, border-color 0.15s;
  }

  .entry:hover,
  .entry.selected {
    background: var(--surface-active);
  }

  .entry.in-progress {
    outline: 1px solid rgba(255, 204, 128, 0.3);
  }

  .entry-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .method-url {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    flex: 1;
  }

  .method {
    font-family: var(--font-ui);
    font-size: 10px;
    font-weight: bold;
    flex-shrink: 0;
  }

  .url {
    font-family: var(--font-body);
    font-size: 15px;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .entry-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }

  .status {
    font-family: var(--font-body);
    font-size: 14px;
  }

  .detail-btn {
    font-family: var(--font-body);
    font-size: 14px;
    color: var(--text-dim);
    background: var(--deep-bg);
    border: 2px solid var(--border);
    border-radius: 3px;
    padding: 0 6px;
    line-height: 1.2;
    transition: all 0.15s;
  }

  .detail-btn:hover {
    color: var(--accent);
    border-color: var(--accent);
    background: var(--surface-active);
  }

  .entry-timing {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 5px;
  }

  .duration-track {
    flex: 1;
    height: 4px;
    background: var(--deep-bg);
    border-radius: 2px;
  }

  .duration-bar {
    height: 100%;
    border-radius: 2px;
    transition: width 0.2s;
  }

  .duration-text {
    font-family: var(--font-body);
    font-size: 13px;
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .error-note {
    font-family: var(--font-body);
    font-size: 13px;
    color: var(--error);
    margin-top: 4px;
  }
</style>
