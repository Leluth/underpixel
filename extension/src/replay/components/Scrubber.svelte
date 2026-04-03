<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { replayStore, findActiveEvent } from '../stores/replay-store';
  import { formatTimestamp } from '../lib/format';
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

  $: eventTicks = (() => {
    const sections = $replayStore.eventSections;
    const start = sessionStart;
    const dur = totalDuration;
    return sections.map((s) => ({
      id: s.id,
      label: s.label,
      position: dur > 0 ? ((s.timestamp - start) / dur) * 100 : 0,
    }));
  })();

  $: tickGroups = (() => {
    const groups: { ticks: typeof eventTicks; position: number }[] = [];
    for (const tick of eventTicks) {
      const last = groups[groups.length - 1];
      if (last && Math.abs(tick.position - last.position) < 1) {
        last.ticks.push(tick);
      } else {
        groups.push({ ticks: [tick], position: tick.position });
      }
    }
    return groups;
  })();

  let pickerGroup: { ticks: typeof eventTicks; position: number } | null = null;

  $: activeTickId = (() => {
    const absTime = $replayStore.session
      ? $replayStore.currentTime + $replayStore.session.startTime
      : 0;
    return findActiveEvent($replayStore.eventSections, absTime)?.id ?? null;
  })();

  export let onEventSelect: (eventId: string, eventTimestamp: number) => void = () => {};

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
    {#each tickGroups as group}
      <!-- svelte-ignore a11y-click-events-have-key-events -->
      <div
        class="tick"
        class:active={group.ticks.some((t) => t.id === activeTickId)}
        style="left: {group.position}%"
        on:click|stopPropagation={() => {
          if (group.ticks.length === 1) {
            const section = $replayStore.eventSections.find((s) => s.id === group.ticks[0].id);
            if (section) onEventSelect(section.id, section.timestamp);
          } else {
            pickerGroup = pickerGroup === group ? null : group;
          }
        }}
        role="button"
        tabindex="0"
      ></div>
    {/each}

    {#if pickerGroup}
      <div class="tick-picker" style="left: {pickerGroup.position}%">
        {#each pickerGroup.ticks as tick}
          <!-- svelte-ignore a11y-click-events-have-key-events -->
          <div
            class="tick-picker-item"
            on:click|stopPropagation={() => {
              const section = $replayStore.eventSections.find((s) => s.id === tick.id);
              if (section) onEventSelect(section.id, section.timestamp);
              pickerGroup = null;
            }}
            role="button"
            tabindex="0"
          >
            {tick.label}
          </div>
        {/each}
      </div>
    {/if}
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
    min-width: 0;
  }

  .track-fill {
    overflow: hidden;
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: linear-gradient(90deg, var(--accent), var(--accent-light));
    transform-origin: left center;
    transform: scaleX(0);
  }

  .tick {
    position: absolute;
    top: -3px;
    width: 4px;
    height: 14px;
    background: var(--accent);
    transform: translateX(-50%);
    cursor: pointer;
    z-index: 1;
    transition: box-shadow 0.2s;
  }

  .tick.active {
    box-shadow: 0 0 6px 2px rgba(255, 138, 128, 0.5);
  }

  .tick-picker {
    position: absolute;
    bottom: 16px;
    transform: translateX(-50%);
    background: var(--surface);
    border: 2px solid var(--border);
    border-radius: 4px;
    padding: 4px 0;
    z-index: 10;
    min-width: 120px;
  }

  .tick-picker-item {
    font-family: var(--font-ui);
    font-size: 10px;
    color: var(--text-secondary);
    padding: 4px 12px;
    cursor: pointer;
    white-space: nowrap;
  }

  .tick-picker-item:hover {
    background: var(--surface-active);
    color: var(--text-primary);
  }

  .speed-btn {
    font-family: var(--font-ui);
    font-size: 10px;
    color: var(--text-secondary);
    min-width: 40px;
    flex-shrink: 0;
  }
</style>
