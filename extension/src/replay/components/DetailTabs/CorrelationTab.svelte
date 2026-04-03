<script lang="ts">
  import type { NetworkRequest } from 'underpixel-shared';
  import { replayStore } from '../../stores/replay-store';

  export let request: NetworkRequest;

  $: bundle = $replayStore.bundles.find((b) =>
    b.apiCalls.includes(request.requestId),
  );
</script>

<div class="tab-content">
  {#if bundle}
    <div class="correlation-info">
      <div class="info-row">
        <span class="label">Trigger</span>
        <span class="val">{bundle.trigger}</span>
      </div>
      <div class="info-row">
        <span class="label">Correlation</span>
        <span class="val">{bundle.correlation}</span>
      </div>
      {#if bundle.domMutationSummary}
        <div class="info-row">
          <span class="label">DOM Changes</span>
          <span class="val">
            +{bundle.domMutationSummary.addedNodes} nodes,
            -{bundle.domMutationSummary.removedNodes} nodes,
            {bundle.domMutationSummary.textChanges} text,
            {bundle.domMutationSummary.attributeChanges} attrs
          </span>
        </div>
      {/if}
      <div class="info-row">
        <span class="label">Related Calls</span>
        <span class="val"
          >{bundle.apiCalls.length} API call{bundle.apiCalls.length > 1
            ? 's'
            : ''}</span
        >
      </div>
    </div>
  {:else}
    <div class="no-correlation">
      <span>No correlation data for this request</span>
    </div>
  {/if}
</div>

<style>
  .correlation-info {
    background: var(--deep-bg);
    border: var(--border-width) solid var(--border);
    border-radius: 4px;
    padding: 10px;
  }
  .info-row {
    display: flex;
    flex-direction: column;
    padding: 6px 0;
    border-bottom: 1px solid var(--surface);
    font-family: var(--font-body);
    font-size: 14px;
  }
  .info-row:last-child {
    border-bottom: none;
  }
  .label {
    color: var(--text-muted);
    font-size: 12px;
    font-family: var(--font-ui);
    margin-bottom: 2px;
  }
  .val {
    color: var(--text-primary);
  }
  .no-correlation {
    color: var(--text-dim);
    font-family: var(--font-body);
    font-size: 14px;
    padding: 20px;
    text-align: center;
  }
</style>
