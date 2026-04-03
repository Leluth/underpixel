<script lang="ts">
  import { replayStore, closeDetail } from '../stores/replay-store';
  import { shortenUrl } from '../lib/format';
  import { statusColor, methodColor } from '../lib/theme';
  import HeadersTab from './DetailTabs/HeadersTab.svelte';
  import RequestTab from './DetailTabs/RequestTab.svelte';
  import ResponseTab from './DetailTabs/ResponseTab.svelte';
  import TimingTab from './DetailTabs/TimingTab.svelte';
  import CorrelationTab from './DetailTabs/CorrelationTab.svelte';

  $: request = $replayStore.detailCallId
    ? $replayStore.allRequests.find(
        (r) => r.requestId === $replayStore.detailCallId,
      )
    : null;

  $: sessionStart = $replayStore.session?.startTime ?? 0;

  let activeTab:
    | 'headers'
    | 'request'
    | 'response'
    | 'timing'
    | 'correlation' = 'headers';

  const tabs = [
    { id: 'headers', label: 'Headers' },
    { id: 'request', label: 'Request' },
    { id: 'response', label: 'Response' },
    { id: 'timing', label: 'Timing' },
    { id: 'correlation', label: 'Correlation' },
  ] as const;

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') closeDetail();
  }

  function copyCurl() {
    if (!request) return;
    const headers = request.requestHeaders
      ? Object.entries(request.requestHeaders)
          .map(([k, v]) => `-H '${k}: ${v}'`)
          .join(' ')
      : '';
    const body = request.requestBody
      ? `-d '${request.requestBody}'`
      : '';
    const cmd =
      `curl -X ${request.method} '${request.url}' ${headers} ${body}`.trim();
    navigator.clipboard.writeText(cmd);
  }

  function copyJson() {
    if (!request) return;
    navigator.clipboard.writeText(JSON.stringify(request, null, 2));
  }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if request}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <div class="backdrop" on:click={closeDetail} role="presentation"></div>

  <div class="panel" role="dialog" aria-label="Request details">
    <div class="panel-header">
      <div class="header-info">
        <span class="method" style="color: {methodColor(request.method)}"
          >{request.method}</span
        >
        <span class="url">{shortenUrl(request.url)}</span>
        <span
          class="status-badge"
          style="color: {statusColor(request.statusCode)}; border-color: {statusColor(request.statusCode)}"
        >
          {request.statusCode ?? '...'}
        </span>
      </div>
      <button class="close-btn" on:click={closeDetail}>✕ ESC</button>
    </div>

    <div class="tab-bar">
      {#each tabs as tab}
        <button
          class="tab"
          class:active={activeTab === tab.id}
          on:click={() => (activeTab = tab.id)}
        >
          {tab.label}
        </button>
      {/each}
    </div>

    <div class="panel-body">
      {#if activeTab === 'headers'}
        <HeadersTab {request} {sessionStart} />
      {:else if activeTab === 'request'}
        <RequestTab {request} />
      {:else if activeTab === 'response'}
        <ResponseTab {request} />
      {:else if activeTab === 'timing'}
        <TimingTab {request} />
      {:else if activeTab === 'correlation'}
        <CorrelationTab {request} />
      {/if}
    </div>

    <div class="panel-footer">
      <button on:click={copyCurl}>Copy cURL</button>
      <button on:click={copyJson}>Copy JSON</button>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    z-index: 100;
  }

  .panel {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    width: 480px;
    background: var(--base-bg);
    border-left: var(--border-width) solid var(--border);
    display: flex;
    flex-direction: column;
    box-shadow: -8px 0 30px rgba(0, 0, 0, 0.5);
    z-index: 101;
    animation: slideIn 0.15s ease-out;
  }

  @keyframes slideIn {
    from {
      transform: translateX(100%);
    }
    to {
      transform: translateX(0);
    }
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 16px;
    background: var(--surface);
    border-bottom: var(--border-width) solid var(--border);
  }

  .header-info {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .method {
    font-family: var(--font-ui);
    font-size: 11px;
    font-weight: bold;
    flex-shrink: 0;
  }

  .url {
    font-family: var(--font-body);
    font-size: 17px;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .status-badge {
    font-family: var(--font-body);
    font-size: 15px;
    background: rgba(255, 255, 255, 0.05);
    padding: 1px 8px;
    border: 1px solid;
    flex-shrink: 0;
  }

  .close-btn {
    font-size: 12px;
    color: var(--text-dim);
  }

  .tab-bar {
    display: flex;
    background: var(--surface);
    border-bottom: var(--border-width) solid var(--border);
    padding: 0 12px;
  }

  .tab {
    font-size: 10px;
    padding: 8px 14px;
    color: var(--text-dim);
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
  }

  .tab.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }

  .panel-body {
    flex: 1;
    overflow-y: auto;
    padding: 12px 16px;
  }

  .panel-footer {
    padding: 8px 16px;
    background: var(--surface);
    border-top: var(--border-width) solid var(--border);
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }
</style>
