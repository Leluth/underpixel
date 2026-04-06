<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { eventWithTime } from '@rrweb/types';
  import {
    replayStore,
    loadSessionData,
  } from '../../src/replay/stores/replay-store';
  import {
    loadSessions,
  } from '../../src/replay/stores/session-store';
  import {
    getSession,
    getRrwebEvents,
    getNetworkRequests,
    getCorrelationBundles,
  } from '../../src/replay/lib/db-queries';
  import { buildEventSections } from '../../src/replay/lib/event-sections';

  import SessionPicker from '../../src/replay/components/SessionPicker.svelte';
  import Player from '../../src/replay/components/Player.svelte';
  import Timeline from '../../src/replay/components/Timeline.svelte';
  import Scrubber from '../../src/replay/components/Scrubber.svelte';
  import DetailPanel from '../../src/replay/components/DetailPanel.svelte';
  import ExportModal from '../../src/replay/components/ExportModal.svelte';
  import { exportSession } from '../../src/replay/lib/export';
  import { importSession } from '../../src/replay/lib/import';
  import type { ExportOptions } from 'underpixel-shared';

  let loading = true;
  let error = '';
  let rrwebEvents: eventWithTime[] = [];
  let playerComponent: Player;
  let totalDuration = 0;

  $: selectedSessionId = $replayStore.session?.id ?? '';

  let showExportModal = false;
  let exporting = false;
  let toastMessage = '';
  let toastType: 'error' | 'success' = 'error';
  let toastTimeout: ReturnType<typeof setTimeout>;

  function showToast(message: string, type: 'error' | 'success' = 'error') {
    toastMessage = message;
    toastType = type;
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      toastMessage = '';
    }, 5000);
  }

  function handleExportClick() {
    if ($replayStore.session) {
      showExportModal = true;
    }
  }

  async function handleExportConfirm(e: CustomEvent<ExportOptions>) {
    showExportModal = false;
    const session = $replayStore.session;
    if (!session) return;

    exporting = true;
    try {
      await exportSession(session.id, e.detail);
      showToast('Session exported', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Export failed');
    } finally {
      exporting = false;
    }
  }

  async function handleImportClick() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.underpixel';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;

      try {
        const newSessionId = await importSession(file);
        await loadSessions();
        await loadSession(newSessionId);
        setSessionInUrl(newSessionId);
        showToast('Session imported', 'success');
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Import failed');
      }
    };
    input.click();
  }

  function setSessionInUrl(sessionId: string) {
    const url = new URL(window.location.href);
    url.searchParams.set('sessionId', sessionId);
    history.replaceState(null, '', url.toString());
  }

  onDestroy(() => clearTimeout(toastTimeout));

  async function loadSession(sessionId: string) {
    loading = true;
    error = '';
    try {
      const session = await getSession(sessionId);
      if (!session) {
        error = `Session ${sessionId} not found`;
        return;
      }

      const [requests, bundles, storedEvents] = await Promise.all([
        getNetworkRequests(sessionId),
        getCorrelationBundles(sessionId),
        getRrwebEvents(sessionId),
      ]);

      console.log(`[UnderPixel Replay] Session ${sessionId}: ${requests.length} requests, ${bundles.length} bundles, ${storedEvents.length} rrweb events`);
      console.log(`[UnderPixel Replay] Session stats:`, session.stats);

      const eventSections = buildEventSections(storedEvents, bundles, requests);
      console.log(`[UnderPixel Replay] Built ${eventSections.length} event sections`);

      loadSessionData(session, requests, bundles, eventSections);

      rrwebEvents = storedEvents.map((e) => ({
        type: e.type,
        data: e.data,
        timestamp: e.timestamp,
      })) as eventWithTime[];

      console.log(`[UnderPixel Replay] Mapped ${rrwebEvents.length} events for player`);

      if (rrwebEvents.length > 0) {
        const first = rrwebEvents[0].timestamp;
        const last = rrwebEvents[rrwebEvents.length - 1].timestamp;
        totalDuration = last - first;
        console.log(`[UnderPixel Replay] Duration: ${totalDuration}ms (${first} → ${last})`);
      } else {
        console.warn('[UnderPixel Replay] No rrweb events found — replay will be empty');
      }
    } catch (e) {
      error = `Failed to load: ${e instanceof Error ? e.message : e}`;
    } finally {
      loading = false;
    }
  }

  onMount(async () => {
    try {
      await loadSessions();

      const params = new URLSearchParams(window.location.search);
      const sessionId = params.get('sessionId');
      const timestamp = params.get('t');

      if (sessionId) {
        await loadSession(sessionId);
        if (timestamp && playerComponent) {
          const t = parseInt(timestamp, 10);
          if (!isNaN(t)) {
            setTimeout(() => playerComponent?.goto(t), 100);
          }
        }
      } else {
        loading = false;
      }
    } catch (e) {
      error = `Failed to initialize: ${e instanceof Error ? e.message : e}`;
      loading = false;
    }
  });

  function handleSessionSelect(e: CustomEvent<string>) {
    loadSession(e.detail);
    setSessionInUrl(e.detail);
  }
</script>

<div class="replay-root pixel-border scanlines">
  {#if loading}
    <div class="center-screen">
      <span class="loading-text">LOADING...</span>
    </div>
  {:else if error}
    <div class="center-screen">
      <span class="error-text">{error}</span>
    </div>
  {:else}
    <header class="top-bar">
      <span class="logo">UNDERPIXEL</span>
      <SessionPicker {selectedSessionId} on:select={handleSessionSelect} />
      <div class="header-actions">
        <button class="import-btn" on:click={handleImportClick}>Import</button>
        <button
          class="export-btn"
          on:click={handleExportClick}
          disabled={!selectedSessionId || exporting}
        >
          {exporting ? 'Exporting...' : 'Export'}
        </button>
      </div>
    </header>

    {#if showExportModal}
      <ExportModal
        on:confirm={handleExportConfirm}
        on:cancel={() => (showExportModal = false)}
      />
    {/if}

    {#if toastMessage}
      <div class="toast toast-{toastType}">{toastMessage}</div>
    {/if}

    {#if $replayStore.session}
      <main class="main-content">
        <div class="player-pane">
          <div class="player-viewport">
            {#if rrwebEvents.length > 0}
              {#key rrwebEvents}
                <Player bind:this={playerComponent} events={rrwebEvents} />
              {/key}
            {:else}
              <div class="empty-player">
                <span style="font-family: var(--font-pixel); font-size: 10px; color: var(--text-dim);">No recording data</span>
                <span style="font-family: var(--font-body); font-size: 14px; color: var(--text-muted);">Start a capture session to see replay</span>
              </div>
            {/if}
          </div>
          <Scrubber
            {totalDuration}
            onToggle={() => playerComponent?.toggle()}
            onSeek={(t) => playerComponent?.goto(t)}
            onSpeedChange={(s) => playerComponent?.setSpeed(s)}
            onEventSelect={(id, ts) => {
              const offset = ts - ($replayStore.session?.startTime ?? 0) - 200;
              playerComponent?.goto(Math.max(0, offset));
            }}
          />
        </div>

        <div class="timeline-pane">
          <Timeline onSeek={(t) => playerComponent?.goto(t)} />
        </div>
      </main>
    {:else}
      <div class="center-screen">
        <span class="no-session-text">Select a session to replay</span>
      </div>
    {/if}
  {/if}

  <DetailPanel />
</div>

<style>
  .replay-root {
    position: relative;
    width: 100vw;
    height: 100vh;
    display: flex;
    flex-direction: column;
    background: var(--base-bg);
    overflow: hidden;
  }

  .center-screen {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 1;
  }

  .loading-text {
    font-family: var(--font-pixel);
    font-size: 12px;
    color: var(--accent);
    animation: blink 1s step-end infinite;
  }

  @keyframes blink {
    50% {
      opacity: 0;
    }
  }

  .error-text {
    font-family: var(--font-body);
    font-size: 16px;
    color: var(--error);
  }

  .no-session-text {
    font-family: var(--font-body);
    font-size: 16px;
    color: var(--text-dim);
  }

  .top-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 16px;
    background: var(--surface);
    border-bottom: var(--border-width) solid var(--border);
    flex-shrink: 0;
  }

  .logo {
    font-family: var(--font-pixel);
    font-size: 9px;
    color: var(--accent);
    text-shadow: 1px 1px 0 #5a1a1a;
  }

  .export-btn {
    color: var(--accent);
    border-color: var(--accent);
  }

  .header-actions {
    display: flex;
    gap: 6px;
  }

  .import-btn {
    color: var(--text-secondary);
  }

  .export-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .toast {
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    font-family: var(--font-ui);
    font-size: 10px;
    padding: 8px 16px;
    border: var(--border-width) solid var(--border);
    z-index: 2000;
    animation: toast-in 0.2s ease-out;
  }

  .toast-error {
    background: #3a1520;
    color: var(--error);
    border-color: var(--error);
  }

  .toast-success {
    background: #152a15;
    color: var(--success);
    border-color: var(--success);
  }

  @keyframes toast-in {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(10px);
    }
    to {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
  }

  .main-content {
    display: flex;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .player-pane {
    flex: 1;
    display: flex;
    flex-direction: column;
    border-right: var(--border-width) solid var(--border);
    min-width: 0;
    overflow: hidden;
  }

  .player-viewport {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .timeline-pane {
    width: 340px;
    min-width: 280px;
    max-width: 40vw;
    flex-shrink: 0;
    overflow: hidden;
  }

  .empty-player {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: 8px;
    background: var(--deep-bg);
  }
</style>
