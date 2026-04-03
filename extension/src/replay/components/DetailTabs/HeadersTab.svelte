<script lang="ts">
  import type { NetworkRequest } from 'underpixel-shared';
  import { formatDuration, formatTimestamp } from '../../lib/format';

  export let request: NetworkRequest;
  export let sessionStart: number;
</script>

<div class="tab-content">
  <div class="section">
    <h4 class="section-label">GENERAL</h4>
    <div class="info-table">
      <div class="info-row">
        <span class="key">URL</span><span class="val">{request.url}</span>
      </div>
      <div class="info-row">
        <span class="key">Method</span><span class="val method"
          >{request.method}</span
        >
      </div>
      <div class="info-row">
        <span class="key">Status</span><span class="val"
          >{request.statusCode ?? 'Pending'}</span
        >
      </div>
      <div class="info-row">
        <span class="key">Duration</span><span class="val"
          >{formatDuration(request.duration)}</span
        >
      </div>
      <div class="info-row">
        <span class="key">Timestamp</span><span class="val"
          >{formatTimestamp(request.startTime - sessionStart)}</span
        >
      </div>
    </div>
  </div>

  {#if request.requestHeaders}
    <div class="section">
      <h4 class="section-label">REQUEST HEADERS</h4>
      <div class="headers-list">
        {#each Object.entries(request.requestHeaders) as [key, value]}
          <div class="header-row">
            <span class="header-key request">{key}:</span>
            <span class="header-val">{value}</span>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  {#if request.responseHeaders}
    <div class="section">
      <h4 class="section-label">RESPONSE HEADERS</h4>
      <div class="headers-list">
        {#each Object.entries(request.responseHeaders) as [key, value]}
          <div class="header-row">
            <span class="header-key response">{key}:</span>
            <span class="header-val">{value}</span>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .section {
    margin-bottom: 16px;
  }
  .section-label {
    font-family: var(--font-pixel);
    font-size: 7px;
    color: var(--text-dim);
    letter-spacing: 1px;
    margin-bottom: 8px;
  }
  .info-table {
    background: var(--deep-bg);
    border: var(--border-width) solid var(--border);
    border-radius: 4px;
    padding: 10px;
  }
  .info-row {
    display: flex;
    justify-content: space-between;
    padding: 3px 0;
    border-bottom: 1px solid var(--surface);
    font-family: var(--font-body);
    font-size: 14px;
  }
  .info-row:last-child {
    border-bottom: none;
  }
  .key {
    color: var(--text-muted);
  }
  .val {
    color: var(--text-primary);
    word-break: break-all;
    text-align: right;
    max-width: 70%;
  }
  .headers-list {
    background: var(--deep-bg);
    border: var(--border-width) solid var(--border);
    border-radius: 4px;
    padding: 10px;
    font-family: var(--font-body);
    font-size: 14px;
  }
  .header-row {
    padding: 2px 0;
    border-bottom: 1px solid var(--surface);
    word-break: break-all;
  }
  .header-row:last-child {
    border-bottom: none;
  }
  .header-key.request {
    color: var(--accent);
  }
  .header-key.response {
    color: var(--success);
  }
  .header-val {
    color: var(--text-secondary);
  }
</style>
