<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { DEFAULT_MASKED_HEADERS } from '../lib/export';
  import type { ExportOptions } from 'underpixel-shared';

  const dispatch = createEventDispatcher<{
    confirm: ExportOptions;
    cancel: void;
  }>();

  let includeScreenshots = true;
  let includeResponseBodies = true;
  let maskSensitiveHeaders = false;
  let maskedHeaderNames = DEFAULT_MASKED_HEADERS.join(', ');

  function handleConfirm() {
    const options: ExportOptions = {
      includeScreenshots,
      includeResponseBodies,
      maskSensitiveHeaders,
      maskedHeaderNames: maskedHeaderNames
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    };
    dispatch('confirm', options);
  }

  function handleCancel() {
    dispatch('cancel');
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      handleCancel();
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') handleCancel();
  }
</script>

<svelte:window on:keydown={handleKeydown} />

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-interactive-supports-focus -->
<div class="modal-backdrop" on:click={handleBackdropClick} role="dialog" aria-modal="true" tabindex="-1">
  <div class="modal pixel-border">
    <h2 class="modal-title">EXPORT SESSION</h2>

    <div class="option-group">
      <label class="option">
        <input type="checkbox" bind:checked={includeScreenshots} />
        <span>Include screenshots</span>
      </label>

      <label class="option">
        <input type="checkbox" bind:checked={includeResponseBodies} />
        <span>Include response bodies</span>
      </label>

      <label class="option">
        <input type="checkbox" bind:checked={maskSensitiveHeaders} />
        <span>Mask sensitive headers</span>
      </label>

      {#if maskSensitiveHeaders}
        <div class="header-list">
          <label class="header-label">
            Headers to mask:
            <input
              type="text"
              bind:value={maskedHeaderNames}
              placeholder="authorization, cookie, ..."
            />
          </label>
        </div>
      {/if}
    </div>

    <div class="modal-actions">
      <button class="cancel-btn" on:click={handleCancel}>Cancel</button>
      <button class="confirm-btn" on:click={handleConfirm}>Export</button>
    </div>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .modal {
    background: var(--surface);
    border: var(--border-width) solid var(--border);
    padding: 20px;
    min-width: 340px;
    max-width: 420px;
  }

  .modal-title {
    font-family: var(--font-pixel);
    font-size: 9px;
    color: var(--accent);
    margin-bottom: 16px;
    text-shadow: 1px 1px 0 #5a1a1a;
  }

  .option-group {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-bottom: 20px;
  }

  .option {
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: var(--font-ui);
    font-size: 10px;
    color: var(--text-secondary);
    cursor: pointer;
  }

  .option input[type='checkbox'] {
    accent-color: var(--accent);
    width: 14px;
    height: 14px;
    cursor: pointer;
  }

  .header-list {
    margin-left: 22px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .header-label {
    font-family: var(--font-ui);
    font-size: 9px;
    color: var(--text-dim);
  }

  .header-list input[type='text'] {
    width: 100%;
  }

  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .cancel-btn {
    color: var(--text-dim);
  }

  .confirm-btn {
    color: var(--accent);
    border-color: var(--accent);
  }
</style>
