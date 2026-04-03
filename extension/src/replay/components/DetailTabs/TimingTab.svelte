<script lang="ts">
  import type { NetworkRequest } from 'underpixel-shared';
  import { formatDuration } from '../../lib/format';

  export let request: NetworkRequest;

  $: total = request.duration ?? 0;
</script>

<div class="tab-content">
  <div class="timing-bar-container">
    <div class="timing-label">Total: {formatDuration(total)}</div>
    <div class="timing-bar">
      <div
        class="timing-fill"
        style="width: 100%; background: var(--warning);"
      ></div>
    </div>
  </div>
  <p class="timing-note">
    Detailed timing breakdown (DNS, TLS, TTFB) requires CDP Timing data.
    Available if chrome.debugger captured timing info for this request.
  </p>
</div>

<style>
  .timing-bar-container {
    margin-bottom: 16px;
  }
  .timing-label {
    font-family: var(--font-body);
    font-size: 16px;
    color: var(--text-primary);
    margin-bottom: 8px;
  }
  .timing-bar {
    height: 12px;
    background: var(--deep-bg);
    border: var(--border-width) solid var(--border);
    border-radius: 2px;
    overflow: hidden;
  }
  .timing-fill {
    height: 100%;
    border-radius: 2px;
  }
  .timing-note {
    font-family: var(--font-body);
    font-size: 13px;
    color: var(--text-dim);
    margin-top: 12px;
  }
</style>
