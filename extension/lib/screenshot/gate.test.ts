import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ScreenshotGate } from './gate';

describe('ScreenshotGate', () => {
  let gate: ScreenshotGate;
  let onReady: ReturnType<typeof vi.fn>;
  let onNavigation: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    onReady = vi.fn();
    onNavigation = vi.fn();
    gate = new ScreenshotGate({
      screenshotInterval: 500,
      maxScreenshotsPerSession: 100,

      onReady,
      onNavigation,
    });
    gate.start();
  });

  afterEach(() => {
    gate.stop();
    vi.useRealTimers();
  });

  it('fires onReady after 500ms debounce when dirty', () => {
    gate.onEvent();
    expect(onReady).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(onReady).toHaveBeenCalledOnce();
  });

  it('does not fire onReady when not dirty', () => {
    vi.advanceTimersByTime(1000);
    expect(onReady).not.toHaveBeenCalled();
  });

  it('resets debounce on subsequent events', () => {
    gate.onEvent();
    vi.advanceTimersByTime(300);
    gate.onEvent();
    vi.advanceTimersByTime(300);
    expect(onReady).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(onReady).toHaveBeenCalledOnce();
  });

  it('respects screenshotInterval guard', () => {
    gate.onEvent();
    vi.advanceTimersByTime(500);
    expect(onReady).toHaveBeenCalledOnce();
    gate.recordScreenshot(); // marks a screenshot taken

    // Fire again immediately — debounce fires at +500ms but only 500ms
    // elapsed since screenshot, which equals the interval, so it fires
    gate.onEvent();
    vi.advanceTimersByTime(500);
    expect(onReady).toHaveBeenCalledTimes(2);

    // Record that screenshot too, then fire within the interval window
    gate.recordScreenshot();
    gate.onEvent();
    vi.advanceTimersByTime(200); // only 200ms elapsed — should be blocked
    expect(onReady).toHaveBeenCalledTimes(2); // still 2

    // After the remaining interval time passes, the re-scheduled timer fires
    vi.advanceTimersByTime(300);
    expect(onReady).toHaveBeenCalledTimes(3);
  });

  it('respects maxScreenshotsPerSession guard', () => {
    const smallGate = new ScreenshotGate({
      screenshotInterval: 0,
      maxScreenshotsPerSession: 2,

      onReady,
      onNavigation,
    });
    smallGate.start();

    smallGate.onEvent();
    vi.advanceTimersByTime(500);
    smallGate.recordScreenshot();

    smallGate.onEvent();
    vi.advanceTimersByTime(500);
    smallGate.recordScreenshot();

    // Third event — should be blocked
    smallGate.onEvent();
    vi.advanceTimersByTime(500);
    expect(onReady).toHaveBeenCalledTimes(2);

    smallGate.stop();
  });

  it('fires onNavigation immediately, bypassing debounce', () => {
    gate.onNavigation();
    expect(onNavigation).toHaveBeenCalledOnce();
    expect(onReady).not.toHaveBeenCalled();
  });

  it('resets dirty flag after onReady fires', () => {
    gate.onEvent();
    vi.advanceTimersByTime(500);
    expect(onReady).toHaveBeenCalledOnce();

    // No new events — should not fire again
    vi.advanceTimersByTime(1000);
    expect(onReady).toHaveBeenCalledOnce();
  });

  it('does not fire after stop()', () => {
    gate.onEvent();
    gate.stop();
    vi.advanceTimersByTime(1000);
    expect(onReady).not.toHaveBeenCalled();
  });

  it('ignores events before start()', () => {
    const freshGate = new ScreenshotGate({
      screenshotInterval: 500,
      maxScreenshotsPerSession: 100,

      onReady,
      onNavigation,
    });
    freshGate.onEvent();
    vi.advanceTimersByTime(1000);
    expect(onReady).not.toHaveBeenCalled();
  });
});
