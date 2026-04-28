export interface ScreenshotGateConfig {
  screenshotInterval: number;
  maxScreenshotsPerSession: number;
  onReady: () => void;
  onNavigation: () => void;
}

export class ScreenshotGate {
  private dirty = false;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private lastScreenshotTime: number | null = null;
  private screenshotCount = 0;
  private active = false;
  private config: ScreenshotGateConfig;

  constructor(config: ScreenshotGateConfig) {
    this.config = config;
  }

  start(): void {
    this.active = true;
    this.dirty = false;
    this.debounceTimer = null;
    this.lastScreenshotTime = null;
    this.screenshotCount = 0;
  }

  stop(): void {
    this.active = false;
    this.dirty = false;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  onEvent(): void {
    if (!this.active) return;

    this.dirty = true;

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.tryFire();
    }, 500);
  }

  onNavigation(): void {
    if (!this.active) return;

    // Navigation always triggers — bypass debounce and pixelmatch
    this.dirty = false;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.config.onNavigation();
  }

  /** Called by the pipeline after a screenshot is successfully stored */
  recordScreenshot(): void {
    this.lastScreenshotTime = Date.now();
    this.screenshotCount++;
  }

  getScreenshotCount(): number {
    return this.screenshotCount;
  }

  private tryFire(): void {
    if (!this.dirty) return;

    // Guard: max screenshots
    if (this.screenshotCount >= this.config.maxScreenshotsPerSession) return;

    // Guard: interval
    if (this.lastScreenshotTime !== null) {
      const now = Date.now();
      const elapsed = now - this.lastScreenshotTime;
      const remaining = this.config.screenshotInterval - elapsed;
      if (remaining > 0) {
        // Re-schedule after remaining interval time
        this.debounceTimer = setTimeout(() => {
          this.debounceTimer = null;
          this.tryFire();
        }, remaining);
        return;
      }
    }

    this.dirty = false;
    this.config.onReady();
  }
}
