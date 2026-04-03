<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import rrwebPlayer from 'rrweb-player';
  import 'rrweb-player/dist/style.css';
  import type { eventWithTime } from '@rrweb/types';
  import {
    setCurrentTime,
    setPlaying,
  } from '../stores/replay-store';

  export let events: eventWithTime[] = [];

  let container: HTMLDivElement;
  let player: rrwebPlayer | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let seekTimer: ReturnType<typeof setTimeout> | null = null;
  let desiredPlaying = false;
  let healthy = true;

  onMount(() => {
    if (events.length === 0) return;
    initPlayer();

    resizeObserver = new ResizeObserver(() => {
      if (!player || !container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w > 0 && h > 0) {
        try {
          player.$set({ width: w, height: h });
          player.triggerResize();
        } catch { /* ignore */ }
      }
    });
    resizeObserver.observe(container);

  });

  function destroyPlayer() {
    if (player) {
      try { player.getReplayer()?.destroy(); } catch { /* may already be destroyed */ }
      player = null;
    }
    container.innerHTML = '';
  }

  function initPlayer() {
    destroyPlayer();
    healthy = true;

    player = new rrwebPlayer({
      target: container,
      props: {
        events,
        width: container.clientWidth,
        height: container.clientHeight,
        autoPlay: false,
        speed: 1,
        showController: false,
        skipInactive: true,
      },
    });

    player.addEventListener(
      'ui-update-current-time',
      (e: { payload: number }) => {
        setCurrentTime(e.payload);
      },
    );

    player.addEventListener(
      'ui-update-player-state',
      (e: { payload: string }) => {
        const isPlaying = e.payload === 'playing';
        desiredPlaying = isPlaying;
        setPlaying(isPlaying);
      },
    );
  }

  function seekTo(offset: number) {
    if (seekTimer) clearTimeout(seekTimer);
    seekTimer = setTimeout(() => {
      seekTimer = null;
      if (!player) return;

      const wasPlaying = desiredPlaying;

      try {
        player.goto(offset, false);
        healthy = true;
      } catch (err) {
        console.warn('[UnderPixel Replay] Seek corrupted player, recreating...', err);
        healthy = false;
        initPlayer();
        try {
          player?.goto(offset, false);
        } catch (err2) {
          console.warn('[UnderPixel Replay] Seek failed even after recreation:', err2);
        }
      }

      if (wasPlaying) {
        try { player?.play(); } catch { /* */ }
      }
    }, 80);
  }

  onDestroy(() => {
    resizeObserver?.disconnect();
    if (seekTimer) clearTimeout(seekTimer);
    destroyPlayer();
  });

  export function play() {
    desiredPlaying = true;
    if (!healthy) { initPlayer(); }
    try { player?.play(); } catch { /* */ }
  }

  export function pause() {
    desiredPlaying = false;
    try { player?.pause(); } catch { /* */ }
  }

  export function toggle() {
    if (desiredPlaying) {
      pause();
    } else {
      play();
    }
  }

  export function goto(timeOffset: number) {
    seekTo(timeOffset);
  }

  export function setSpeed(speed: number) {
    try { player?.setSpeed(speed); } catch { /* */ }
  }

  export function getMetaData() {
    return player?.getMetaData();
  }
</script>

<div class="player-container" bind:this={container}>
  {#if events.length === 0}
    <div class="empty-player">
      <span class="empty-text">No recording data</span>
      <span class="empty-hint">Start a capture session to see replay</span>
    </div>
  {/if}
</div>

<style>
  .player-container {
    width: 100%;
    height: 100%;
    position: relative;
    background: var(--deep-bg);
    overflow: hidden;
  }

  .player-container :global(.rr-player) {
    background: var(--deep-bg) !important;
    width: 100% !important;
    height: 100% !important;
  }

  .player-container :global(.rr-player__frame) {
    border: var(--border-width) solid var(--border) !important;
  }

  .empty-player {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: 8px;
  }

  .empty-text {
    font-family: var(--font-pixel);
    font-size: 10px;
    color: var(--text-dim);
  }

  .empty-hint {
    font-family: var(--font-body);
    font-size: 14px;
    color: var(--text-muted);
  }
</style>
