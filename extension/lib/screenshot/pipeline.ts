import type { StoredScreenshot, ScreenshotTrigger } from 'underpixel-shared';

export interface ScreenshotPipelineDeps {
  captureVisibleTab: (tabId: number) => Promise<string>;
  sendMessageToOffscreen: (message: {
    type: 'pixel-diff';
    previous: string;
    current: string;
  }) => Promise<{ diffRatio: number; width: number; height: number }>;
  storeScreenshot: (screenshot: StoredScreenshot) => Promise<void>;
  pixelDiffThreshold: number;
}

export interface CaptureResult {
  stored: boolean;
  diffRatio?: number;
  screenshotId?: string;
  error?: string;
}

export class ScreenshotPipeline {
  private previousDataUrl: string | null = null;
  private deps: ScreenshotPipelineDeps;

  constructor(deps: ScreenshotPipelineDeps) {
    this.deps = deps;
  }

  /** Capture screenshot, compare with pixelmatch, store if diff > threshold */
  async captureAndCompare(tabId: number, sessionId: string): Promise<CaptureResult> {
    let currentDataUrl: string;
    try {
      currentDataUrl = await this.deps.captureVisibleTab(tabId);
    } catch (err) {
      console.warn('[UnderPixel] captureVisibleTab failed:', err);
      return { stored: false, error: (err as Error).message };
    }

    // First screenshot — store directly
    if (!this.previousDataUrl) {
      const id = await this.store(currentDataUrl, sessionId, 'dom-mutation');
      this.previousDataUrl = currentDataUrl;
      return { stored: true, diffRatio: undefined, screenshotId: id };
    }

    // Compare with previous
    let diffRatio: number;
    let width = 0;
    let height = 0;
    try {
      const result = await this.deps.sendMessageToOffscreen({
        type: 'pixel-diff',
        previous: this.previousDataUrl,
        current: currentDataUrl,
      });
      diffRatio = result.diffRatio;
      width = result.width;
      height = result.height;
    } catch (err) {
      // Offscreen doc error — store anyway to be safe
      console.warn('[UnderPixel] Offscreen diff failed, storing screenshot:', err);
      const id = await this.store(currentDataUrl, sessionId, 'dom-mutation');
      this.previousDataUrl = currentDataUrl;
      return { stored: true, diffRatio: undefined, screenshotId: id };
    }

    if (diffRatio > this.deps.pixelDiffThreshold) {
      const id = await this.store(
        currentDataUrl,
        sessionId,
        'dom-mutation',
        diffRatio,
        width,
        height,
      );
      this.previousDataUrl = currentDataUrl;
      return { stored: true, diffRatio, screenshotId: id };
    }

    return { stored: false, diffRatio };
  }

  /** Capture screenshot on navigation — skip pixelmatch, always store */
  async captureNavigation(tabId: number, sessionId: string): Promise<CaptureResult> {
    let currentDataUrl: string;
    try {
      currentDataUrl = await this.deps.captureVisibleTab(tabId);
    } catch (err) {
      console.warn('[UnderPixel] captureVisibleTab failed on navigation:', err);
      return { stored: false, error: (err as Error).message };
    }

    const id = await this.store(currentDataUrl, sessionId, 'navigation');
    this.previousDataUrl = currentDataUrl;
    return { stored: true, screenshotId: id };
  }

  reset(): void {
    this.previousDataUrl = null;
  }

  private async store(
    dataUrl: string,
    sessionId: string,
    trigger: ScreenshotTrigger,
    diffPercent?: number,
    width = 0,
    height = 0,
  ): Promise<string> {
    const id = crypto.randomUUID();
    const screenshot: StoredScreenshot = {
      id,
      sessionId,
      timestamp: Date.now(),
      dataUrl,
      width,
      height,
      trigger,
      diffPercent,
    };
    await this.deps.storeScreenshot(screenshot);
    return id;
  }
}
