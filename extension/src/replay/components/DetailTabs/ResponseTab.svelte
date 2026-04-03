<script lang="ts">
  import type { NetworkRequest } from 'underpixel-shared';
  import { getResponseBody } from '../../lib/db-queries';
  import { isBinary } from '../../lib/format';

  export let request: NetworkRequest;

  let fullBody: string | null = null;
  let loadingBody = false;

  $: inlineBody = request.responseBody ?? '';
  $: hasRef = !!request.responseBodyRef;
  $: body = fullBody ?? inlineBody;
  $: binary = isBinary(body);
  $: isJson = !binary && (() => {
    try {
      JSON.parse(body);
      return true;
    } catch {
      return false;
    }
  })();
  $: formatted = binary
    ? ''
    : isJson
      ? JSON.stringify(JSON.parse(body), null, 2)
      : body;

  async function loadFull() {
    if (!request.responseBodyRef) return;
    loadingBody = true;
    try {
      fullBody =
        (await getResponseBody(request.requestId)) ?? '(body not found)';
    } finally {
      loadingBody = false;
    }
  }
</script>

<div class="tab-content">
  {#if binary}
    <div class="binary-notice">
      <span class="binary-icon">&#9638;</span>
      <span>Binary data ({body.length.toLocaleString()} bytes)</span>
      <span class="binary-hint">Content type: {request.mimeType ?? 'unknown'}</span>
    </div>
  {:else if body}
    <pre class="body-pre">{formatted}</pre>
    {#if hasRef && !fullBody}
      <button class="load-btn" on:click={loadFull} disabled={loadingBody}>
        {loadingBody ? 'Loading...' : 'Load full body'}
      </button>
    {/if}
  {:else}
    <div class="empty">No response body</div>
  {/if}
</div>

<style>
  .body-pre {
    background: var(--deep-bg);
    border: var(--border-width) solid var(--border);
    border-radius: 4px;
    padding: 12px;
    font-family: var(--font-body);
    font-size: 14px;
    color: var(--text-primary);
    overflow: auto;
    max-height: 100%;
    white-space: pre-wrap;
    word-break: break-all;
  }
  .load-btn {
    margin-top: 8px;
    color: var(--accent);
    border-color: var(--accent);
  }
  .empty, .binary-notice {
    color: var(--text-dim);
    font-family: var(--font-body);
    font-size: 14px;
    padding: 20px;
    text-align: center;
  }
  .binary-notice {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    background: var(--deep-bg);
    border: var(--border-width) solid var(--border);
    border-radius: 4px;
  }
  .binary-icon {
    font-size: 24px;
    color: var(--text-muted);
  }
  .binary-hint {
    font-size: 12px;
    color: var(--text-dim);
  }
</style>
