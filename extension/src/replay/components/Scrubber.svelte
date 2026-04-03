<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { replayStore } from '../stores/replay-store';
  import { formatTimestamp } from '../lib/format';
  import { statusColor } from '../lib/theme';

  export let totalDuration: number = 0;
  export let onToggle: () => void = () => {};
  export let onSeek: (time: number) => void = () => {};
  export let onSpeedChange: (speed: number) => void = () => {};

  let track: HTMLDivElement;
  let fillEl: HTMLDivElement;
  let timeEl: HTMLSpanElement;
  let currentSpeed = 1;
  const speeds = [1, 2, 4];

  $: sessionStart = $replayStore.session?.startTime ?? 0;
  $: playing = $replayStore.isPlaying;

  // Compute markers only when requests change
  let cachedMarkers: { requestId: string; position: number; color: string }[] =
    [];
  $: {
    const reqs = $replayStore.allRequests;
    const bundles = $replayStore.bundles;
    const start = sessionStart;
    const dur = totalDuration;
    // Build set of request IDs that belong to correlation bundles
    const correlatedIds = new Set(bundles.flatMap((b) => b.apiCalls));
    // Uncorrelated markers first so correlated ones paint on top when overlapping
    const uncorrelated = reqs.filter((r) => !correlatedIds.has(r.requestId));
    const correlated = reqs.filter((r) => correlatedIds.has(r.requestId));
    cachedMarkers = [...uncorrelated, ...correlated].map((r) => ({
      requestId: r.requestId,
      position: dur > 0 ? ((r.startTime - start) / dur) * 100 : 0,
      color: correlatedIds.has(r.requestId)
        ? statusColor(r.statusCode)
        : 'var(--text-dim)',
    }));
  }

  // Direct DOM updates for the fill bar and time display — avoids Svelte re-render on every frame
  let unsubscribe: (() => void) | null = null;

  onMount(() => {
    unsubscribe = replayStore.subscribe((state) => {
      if (!fillEl || !timeEl) return;
      const progress =
        totalDuration > 0 ? state.currentTime / totalDuration : 0;
      fillEl.style.transform = `scaleX(${Math.min(progress, 1)})`;
      timeEl.textContent = `${formatTimestamp(state.currentTime)} / ${formatTimestamp(totalDuration)}`;
    });
  });

  onDestroy(() => {
    unsubscribe?.();
  });

  function handleTrackClick(e: MouseEvent) {
    if (!track || totalDuration === 0) return;
    const rect = track.getBoundingClientRect();
    const pct = Math.max(0, Math.min((e.clientX - rect.left) / rect.width, 1));
    onSeek(pct * totalDuration);
  }

  function cycleSpeed() {
    const idx = speeds.indexOf(currentSpeed);
    currentSpeed = speeds[(idx + 1) % speeds.length];
    onSpeedChange(currentSpeed);
  }
</script>

<div class="scrubber">
  <button class="ctrl-btn" on:click={() => onSeek(0)}>◀◀</button>
  <button class="ctrl-btn play-btn" on:click={onToggle}>
    {playing ? '⏸' : '▶'}
  </button>
  <button class="ctrl-btn" on:click={() => onSeek(totalDuration)}>▶▶</button>

  <span class="time-display" bind:this={timeEl}>
    00:00.000 / {formatTimestamp(totalDuration)}
  </span>

  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <div
    class="track"
    bind:this={track}
    on:click={handleTrackClick}
    role="slider"
    tabindex="0"
    aria-valuenow={0}
    aria-valuemin={0}
    aria-valuemax={totalDuration}
  >
    <div class="track-fill" bind:this={fillEl}></div>
    {#each cachedMarkers as marker (marker.requestId)}
      <div
        class="marker"
        style="left: {marker.position}%; background: {marker.color}"
      ></div>
    {/each}
  </div>

  <button class="speed-btn" on:click={cycleSpeed}>{currentSpeed}x ▾</button>
</div>

<style>
  .scrubber {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 16px;
    background: var(--surface);
    border-top: var(--border-width) solid var(--border);
    overflow: hidden;
  }

  .ctrl-btn {
    font-family: var(--font-ui);
    font-size: 12px;
    color: var(--accent);
    background: none;
    border: none;
    padding: 4px;
    flex-shrink: 0;
  }

  .play-btn {
    font-size: 18px;
    text-shadow: 0 0 10px rgba(255, 138, 128, 0.4);
  }

  .time-display {
    font-family: var(--font-body);
    font-size: 14px;
    color: var(--text-secondary);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .track {
    flex: 1;
    height: 8px;
    background: var(--deep-bg);
    border: var(--border-width) solid var(--border);
    position: relative;
    cursor: pointer;
    overflow: hidden;
    min-width: 0;
  }

  .track-fill {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: linear-gradient(90deg, var(--accent), var(--accent-light));
    transform-origin: left center;
    transform: scaleX(0);
  }

  .marker {
    position: absolute;
    top: -3px;
    width: 4px;
    height: 14px;
    transform: translateX(-50%);
    pointer-events: none;
    z-index: 1;
  }

  .speed-btn {
    font-family: var(--font-ui);
    font-size: 10px;
    color: var(--text-secondary);
    min-width: 40px;
    flex-shrink: 0;
  }
</style>
