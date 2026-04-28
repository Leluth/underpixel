# Smart Screenshot Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add automatic screenshot capture during active capture sessions, using a 2-layer gate (debounced rrweb/layout-shift events → pixelmatch diff in an offscreen document).

**Architecture:** A `ScreenshotGate` class in the background tracks dirty/stable state from rrweb and layout-shift events already flowing through `background.ts`. When stable (500ms debounce), it fires a callback. The background pipeline then captures a screenshot via `captureVisibleTab`, sends it to an offscreen document for pixelmatch comparison against the previous screenshot, and stores it in IndexedDB (attached to a correlation bundle) if the diff exceeds the threshold.

**Tech Stack:** Chrome Extensions (Manifest V3, WXT), pixelmatch, chrome.offscreen API, IndexedDB (via idb), TypeScript, Vitest

---

### Task 1: Update shared config defaults

**Files:**

- Modify: `packages/shared/src/constants.ts:44-62`
- Modify: `packages/shared/src/types.ts:52` (change `pixelDiffThreshold` type)

- [ ] **Step 1: Update `pixelDiffThreshold` type from `'auto' | number` to `number`**

In `packages/shared/src/types.ts`, change line 52:

```typescript
// Before:
pixelDiffThreshold: 'auto' | number;

// After:
pixelDiffThreshold: number;
```

- [ ] **Step 2: Update default config to use numeric threshold**

In `packages/shared/src/constants.ts`, change line 52:

```typescript
// Before:
pixelDiffThreshold: 'auto' as const,

// After:
pixelDiffThreshold: 0.01,
```

- [ ] **Step 3: Run tests to verify nothing breaks**

Run: `cd C:/Projects/web-tool/underpixel && pnpm test`
Expected: All 132 tests pass. The `constants.test.ts` may need updating if it asserts on `'auto'`.

- [ ] **Step 4: Fix any test assertions referencing `'auto'`**

Check `packages/shared/src/constants.test.ts` for assertions on `pixelDiffThreshold`. If found, update to expect `0.01`.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/constants.ts packages/shared/src/constants.test.ts
git commit -m "feat: change pixelDiffThreshold default from 'auto' to 0.01 (1%)"
```

---

### Task 2: Add `screenshotConfig` parameter to `capture_start` tool schema

**Files:**

- Modify: `packages/shared/src/tool-schemas.ts:81-120`

- [ ] **Step 1: Add screenshotConfig properties to capture_start schema**

In `packages/shared/src/tool-schemas.ts`, replace the `screenshotsEnabled` property in the `CAPTURE_START` schema with a full `screenshotConfig` object:

```typescript
{
    name: TOOL_NAMES.CAPTURE_START,
    description:
      'Start recording network traffic + DOM changes + visual state on the active tab. ' +
      'Records all XHR/fetch calls with full request/response details. ' +
      'Shows "Chrome is being controlled" banner while active.',
    inputSchema: {
      type: 'object',
      properties: {
        filter: {
          type: 'object',
          description: 'Network capture filter',
          properties: {
            includeStatic: {
              type: 'boolean',
              description: 'Include CSS/JS/images (default: false)',
            },
            excludeDomains: {
              type: 'array',
              items: { type: 'string' },
              description: 'Domains to exclude',
            },
            includeDomains: {
              type: 'array',
              items: { type: 'string' },
              description: 'Only capture these domains',
            },
          },
        },
        screenshotConfig: {
          type: 'object',
          description: 'Auto-screenshot settings (overrides popup defaults for this session)',
          properties: {
            enabled: {
              type: 'boolean',
              description: 'Enable auto-screenshots (default: true)',
            },
            maxPerSession: {
              type: 'number',
              description: 'Max screenshots per session (default: 100)',
            },
            interval: {
              type: 'number',
              description: 'Min ms between screenshots (default: 500)',
            },
            diffThreshold: {
              type: 'number',
              description: 'Pixel diff ratio to trigger save, 0.0-1.0 (default: 0.01 = 1%)',
            },
          },
        },
        tabId: {
          type: 'number',
          description: 'Tab to capture (default: active tab)',
        },
      },
    },
  },
```

- [ ] **Step 2: Run tests**

Run: `cd C:/Projects/web-tool/underpixel && pnpm test`
Expected: All tests pass. `tool-schemas.test.ts` may need updating if it snapshots the schema.

- [ ] **Step 3: Fix any failing schema tests**

If `tool-schemas.test.ts` asserts on the old `screenshotsEnabled` property, update to match the new `screenshotConfig` shape.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/tool-schemas.ts packages/shared/src/tool-schemas.test.ts
git commit -m "feat: add screenshotConfig param to capture_start tool schema"
```

---

### Task 3: Update `capture_start` tool to read screenshotConfig

**Files:**

- Modify: `extension/lib/tools/network.ts:16-94`

- [ ] **Step 1: Update capture_start handler to merge screenshotConfig**

In `extension/lib/tools/network.ts`, update the `capture_start` handler. Replace lines 17-36:

```typescript
toolRegistry.register(TOOL_NAMES.CAPTURE_START, async (args) => {
  const filter = (args.filter as Partial<CaptureConfig>) || {};
  const screenshotConfig = args.screenshotConfig as {
    enabled?: boolean;
    maxPerSession?: number;
    interval?: number;
    diffThreshold?: number;
  } | undefined;

  // Resolve target tab
  let tabId = resolveTabId(args.tabId);
  if (!tabId) tabId = await getActiveTabId();

  const tab = await chrome.tabs.get(tabId);

  // chrome:// and edge:// URLs can't be captured
  if (tab.url && /^(chrome|edge|about|devtools):/.test(tab.url)) {
    throw new Error(`Cannot capture on ${tab.url} — navigate to a regular webpage first`);
  }

  // Read popup defaults from chrome.storage.local
  const stored = await chrome.storage.local.get([
    'screenshotsEnabled',
    'maxScreenshotsPerSession',
    'screenshotInterval',
    'pixelDiffThreshold',
  ]);

  // Build config: defaults ← popup settings ← MCP tool overrides
  const config: CaptureConfig = {
    ...DEFAULT_CAPTURE_CONFIG,
    ...filter,
    screenshotsEnabled: screenshotConfig?.enabled
      ?? stored.screenshotsEnabled
      ?? DEFAULT_CAPTURE_CONFIG.screenshotsEnabled,
    maxScreenshotsPerSession: screenshotConfig?.maxPerSession
      ?? stored.maxScreenshotsPerSession
      ?? DEFAULT_CAPTURE_CONFIG.maxScreenshotsPerSession,
    screenshotInterval: screenshotConfig?.interval
      ?? stored.screenshotInterval
      ?? DEFAULT_CAPTURE_CONFIG.screenshotInterval,
    pixelDiffThreshold: screenshotConfig?.diffThreshold
      ?? stored.pixelDiffThreshold
      ?? DEFAULT_CAPTURE_CONFIG.pixelDiffThreshold,
  } as CaptureConfig;
```

- [ ] **Step 2: Update the return value to include screenshot config**

In the return block (around line 83-94), update to:

```typescript
return {
  summary: `Capture started on "${tab.title}" (tab ${tabId})`,
  sessionId: session.id,
  tabId,
  url: tab.url,
  config: {
    includeStatic: config.includeStatic,
    screenshotsEnabled: config.screenshotsEnabled,
    pixelDiffThreshold: config.pixelDiffThreshold,
    correlationWindow: config.correlationWindow,
  },
};
```

- [ ] **Step 3: Run tests**

Run: `cd C:/Projects/web-tool/underpixel && pnpm test`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add extension/lib/tools/network.ts
git commit -m "feat: capture_start reads screenshotConfig with popup defaults fallback"
```

---

### Task 4: Install pixelmatch dependency

**Files:**

- Modify: `extension/package.json`

- [ ] **Step 1: Add pixelmatch to extension dependencies**

Run: `cd C:/Projects/web-tool/underpixel/extension && pnpm add pixelmatch`

- [ ] **Step 2: Verify it installed**

Run: `cd C:/Projects/web-tool/underpixel && pnpm test`
Expected: All tests pass. No breakage from new dependency.

- [ ] **Step 3: Commit**

```bash
git add extension/package.json pnpm-lock.yaml
git commit -m "chore: add pixelmatch dependency for screenshot diff"
```

---

### Task 5: Implement ScreenshotGate class (TDD)

**Files:**

- Create: `extension/lib/screenshot/gate.ts`
- Create: `extension/lib/screenshot/gate.test.ts`

- [ ] **Step 1: Write failing tests for ScreenshotGate**

Create `extension/lib/screenshot/gate.test.ts`:

```typescript
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
      pixelDiffThreshold: 0.01,
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
    gate.onEvent('rrweb');
    expect(onReady).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(onReady).toHaveBeenCalledOnce();
  });

  it('does not fire onReady when not dirty', () => {
    vi.advanceTimersByTime(1000);
    expect(onReady).not.toHaveBeenCalled();
  });

  it('resets debounce on subsequent events', () => {
    gate.onEvent('rrweb');
    vi.advanceTimersByTime(300);
    gate.onEvent('layout-shift');
    vi.advanceTimersByTime(300);
    expect(onReady).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(onReady).toHaveBeenCalledOnce();
  });

  it('respects screenshotInterval guard', () => {
    gate.onEvent('rrweb');
    vi.advanceTimersByTime(500);
    expect(onReady).toHaveBeenCalledOnce();
    gate.recordScreenshot(); // marks a screenshot taken

    // Fire again immediately — should be blocked by interval
    gate.onEvent('rrweb');
    vi.advanceTimersByTime(500);
    expect(onReady).toHaveBeenCalledTimes(1); // still 1

    // After interval passes
    vi.advanceTimersByTime(500);
    gate.onEvent('rrweb');
    vi.advanceTimersByTime(500);
    expect(onReady).toHaveBeenCalledTimes(2);
  });

  it('respects maxScreenshotsPerSession guard', () => {
    const smallGate = new ScreenshotGate({
      screenshotInterval: 0,
      maxScreenshotsPerSession: 2,
      pixelDiffThreshold: 0.01,
      onReady,
      onNavigation,
    });
    smallGate.start();

    smallGate.onEvent('rrweb');
    vi.advanceTimersByTime(500);
    smallGate.recordScreenshot();

    smallGate.onEvent('rrweb');
    vi.advanceTimersByTime(500);
    smallGate.recordScreenshot();

    // Third event — should be blocked
    smallGate.onEvent('rrweb');
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
    gate.onEvent('rrweb');
    vi.advanceTimersByTime(500);
    expect(onReady).toHaveBeenCalledOnce();

    // No new events — should not fire again
    vi.advanceTimersByTime(1000);
    expect(onReady).toHaveBeenCalledOnce();
  });

  it('does not fire after stop()', () => {
    gate.onEvent('rrweb');
    gate.stop();
    vi.advanceTimersByTime(1000);
    expect(onReady).not.toHaveBeenCalled();
  });

  it('ignores events before start()', () => {
    const freshGate = new ScreenshotGate({
      screenshotInterval: 500,
      maxScreenshotsPerSession: 100,
      pixelDiffThreshold: 0.01,
      onReady,
      onNavigation,
    });
    freshGate.onEvent('rrweb');
    vi.advanceTimersByTime(1000);
    expect(onReady).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:/Projects/web-tool/underpixel && pnpm test -- extension/lib/screenshot/gate.test.ts`
Expected: FAIL — module `./gate` not found.

- [ ] **Step 3: Implement ScreenshotGate**

Create `extension/lib/screenshot/gate.ts`:

```typescript
export interface ScreenshotGateConfig {
  screenshotInterval: number;
  maxScreenshotsPerSession: number;
  pixelDiffThreshold: number;
  onReady: () => void;
  onNavigation: () => void;
}

export class ScreenshotGate {
  private dirty = false;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private lastScreenshotTime = 0;
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
    this.lastScreenshotTime = 0;
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

  onEvent(_type: 'rrweb' | 'layout-shift'): void {
    if (!this.active) return;

    this.dirty = true;

    // Reset debounce timer
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
    const now = Date.now();
    if (now - this.lastScreenshotTime < this.config.screenshotInterval) {
      // Re-schedule after remaining interval time
      const remaining = this.config.screenshotInterval - (now - this.lastScreenshotTime);
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        this.tryFire();
      }, remaining);
      return;
    }

    this.dirty = false;
    this.config.onReady();
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd C:/Projects/web-tool/underpixel && pnpm test -- extension/lib/screenshot/gate.test.ts`
Expected: All 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add extension/lib/screenshot/gate.ts extension/lib/screenshot/gate.test.ts
git commit -m "feat: implement ScreenshotGate with debounce, guards, and navigation bypass"
```

---

### Task 6: Create offscreen document

**Files:**

- Create: `extension/entrypoints/offscreen/index.html`
- Create: `extension/entrypoints/offscreen/main.ts`

- [ ] **Step 1: Create offscreen HTML**

Create `extension/entrypoints/offscreen/index.html`:

```html
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
  </head>
  <body>
    <canvas id="canvas-a" style="display:none"></canvas>
    <canvas id="canvas-b" style="display:none"></canvas>
    <script src="./main.ts" type="module"></script>
  </body>
</html>
```

- [ ] **Step 2: Implement offscreen pixel diff handler**

Create `extension/entrypoints/offscreen/main.ts`:

```typescript
import pixelmatch from 'pixelmatch';

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== 'pixel-diff') return false;

  handlePixelDiff(message.previous as string, message.current as string)
    .then((result) => sendResponse(result))
    .catch((err) => sendResponse({ error: String(err), diffRatio: 1.0 }));

  return true; // async response
});

async function handlePixelDiff(
  previousDataUrl: string,
  currentDataUrl: string,
): Promise<{ diffRatio: number }> {
  const [imgA, imgB] = await Promise.all([loadImage(previousDataUrl), loadImage(currentDataUrl)]);

  const width = Math.min(imgA.width, imgB.width);
  const height = Math.min(imgA.height, imgB.height);

  if (width === 0 || height === 0) {
    return { diffRatio: 1.0 };
  }

  const canvasA = document.getElementById('canvas-a') as HTMLCanvasElement;
  const canvasB = document.getElementById('canvas-b') as HTMLCanvasElement;
  canvasA.width = width;
  canvasA.height = height;
  canvasB.width = width;
  canvasB.height = height;

  const ctxA = canvasA.getContext('2d')!;
  const ctxB = canvasB.getContext('2d')!;
  ctxA.drawImage(imgA, 0, 0, width, height);
  ctxB.drawImage(imgB, 0, 0, width, height);

  const dataA = ctxA.getImageData(0, 0, width, height);
  const dataB = ctxB.getImageData(0, 0, width, height);

  const diffPixels = pixelmatch(dataA.data, dataB.data, null, width, height, {
    threshold: 0.1,
  });

  return { diffRatio: diffPixels / (width * height) };
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = dataUrl;
  });
}
```

- [ ] **Step 3: Verify WXT picks up the offscreen entrypoint**

Run: `cd C:/Projects/web-tool/underpixel/extension && pnpm build`
Expected: Build succeeds. Check `.output/chrome-mv3/` for offscreen files.

- [ ] **Step 4: Commit**

```bash
git add extension/entrypoints/offscreen/index.html extension/entrypoints/offscreen/main.ts
git commit -m "feat: add offscreen document for pixelmatch screenshot comparison"
```

---

### Task 7: Implement screenshot pipeline in background

**Files:**

- Create: `extension/lib/screenshot/pipeline.ts`
- Create: `extension/lib/screenshot/pipeline.test.ts`

- [ ] **Step 1: Write failing tests for the screenshot pipeline**

Create `extension/lib/screenshot/pipeline.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScreenshotPipeline } from './pipeline';

// Mock chrome APIs
const mockCaptureVisibleTab = vi.fn();
const mockSendMessage = vi.fn();
const mockDbPut = vi.fn();
const mockDbGet = vi.fn();

describe('ScreenshotPipeline', () => {
  let pipeline: ScreenshotPipeline;

  beforeEach(() => {
    vi.clearAllMocks();
    pipeline = new ScreenshotPipeline({
      captureVisibleTab: mockCaptureVisibleTab,
      sendMessageToOffscreen: mockSendMessage,
      storeScreenshot: mockDbPut,
      getSession: mockDbGet,
      pixelDiffThreshold: 0.01,
    });
  });

  it('stores first screenshot directly (no diff)', async () => {
    mockCaptureVisibleTab.mockResolvedValue('data:image/jpeg;base64,first');

    const result = await pipeline.captureAndCompare(1, 'session-1');

    expect(mockCaptureVisibleTab).toHaveBeenCalledOnce();
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(mockDbPut).toHaveBeenCalledOnce();
    expect(result.stored).toBe(true);
    expect(result.diffRatio).toBeUndefined();
    expect(result.screenshotId).toBeDefined();
  });

  it('sends to offscreen for diff on second screenshot', async () => {
    mockCaptureVisibleTab.mockResolvedValue('data:image/jpeg;base64,first');
    await pipeline.captureAndCompare(1, 'session-1');

    mockCaptureVisibleTab.mockResolvedValue('data:image/jpeg;base64,second');
    mockSendMessage.mockResolvedValue({ diffRatio: 0.05 });

    const result = await pipeline.captureAndCompare(1, 'session-1');

    expect(mockSendMessage).toHaveBeenCalledWith({
      type: 'pixel-diff',
      previous: 'data:image/jpeg;base64,first',
      current: 'data:image/jpeg;base64,second',
    });
    expect(mockDbPut).toHaveBeenCalledTimes(2);
    expect(result.stored).toBe(true);
    expect(result.diffRatio).toBe(0.05);
    expect(result.screenshotId).toBeDefined();
  });

  it('discards screenshot when diff below threshold', async () => {
    mockCaptureVisibleTab.mockResolvedValue('data:image/jpeg;base64,first');
    await pipeline.captureAndCompare(1, 'session-1');

    mockCaptureVisibleTab.mockResolvedValue('data:image/jpeg;base64,same');
    mockSendMessage.mockResolvedValue({ diffRatio: 0.005 });

    const result = await pipeline.captureAndCompare(1, 'session-1');

    expect(mockDbPut).toHaveBeenCalledTimes(1); // only first
    expect(result.stored).toBe(false);
    expect(result.diffRatio).toBe(0.005);
  });

  it('stores navigation screenshots directly (no diff)', async () => {
    mockCaptureVisibleTab.mockResolvedValue('data:image/jpeg;base64,first');
    await pipeline.captureAndCompare(1, 'session-1');

    mockCaptureVisibleTab.mockResolvedValue('data:image/jpeg;base64,nav');
    const result = await pipeline.captureNavigation(1, 'session-1');

    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(mockDbPut).toHaveBeenCalledTimes(2);
    expect(result.stored).toBe(true);
    expect(result.screenshotId).toBeDefined();
  });

  it('returns stored: false when captureVisibleTab fails', async () => {
    mockCaptureVisibleTab.mockRejectedValue(new Error('Tab is not active'));

    const result = await pipeline.captureAndCompare(1, 'session-1');

    expect(result).toEqual({ stored: false, error: 'Tab is not active' });
    expect(mockDbPut).not.toHaveBeenCalled();
  });

  it('resets previousDataUrl on reset()', async () => {
    mockCaptureVisibleTab.mockResolvedValue('data:image/jpeg;base64,first');
    await pipeline.captureAndCompare(1, 'session-1');

    pipeline.reset();

    mockCaptureVisibleTab.mockResolvedValue('data:image/jpeg;base64,after-reset');
    await pipeline.captureAndCompare(1, 'session-1');

    // Second capture should be treated as first (no diff)
    expect(mockSendMessage).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:/Projects/web-tool/underpixel && pnpm test -- extension/lib/screenshot/pipeline.test.ts`
Expected: FAIL — module `./pipeline` not found.

- [ ] **Step 3: Implement ScreenshotPipeline**

Create `extension/lib/screenshot/pipeline.ts`:

```typescript
import type { StoredScreenshot, ScreenshotTrigger } from 'underpixel-shared';

export interface ScreenshotPipelineDeps {
  captureVisibleTab: (tabId: number) => Promise<string>;
  sendMessageToOffscreen: (message: {
    type: 'pixel-diff';
    previous: string;
    current: string;
  }) => Promise<{ diffRatio: number }>;
  storeScreenshot: (screenshot: StoredScreenshot) => Promise<void>;
  getSession: (sessionId: string) => Promise<{ tabId: number } | undefined>;
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
    try {
      const result = await this.deps.sendMessageToOffscreen({
        type: 'pixel-diff',
        previous: this.previousDataUrl,
        current: currentDataUrl,
      });
      diffRatio = result.diffRatio;
    } catch (err) {
      // Offscreen doc error — store anyway to be safe
      console.warn('[UnderPixel] Offscreen diff failed, storing screenshot:', err);
      const id = await this.store(currentDataUrl, sessionId, 'dom-mutation');
      this.previousDataUrl = currentDataUrl;
      return { stored: true, diffRatio: undefined, screenshotId: id };
    }

    if (diffRatio > this.deps.pixelDiffThreshold) {
      const id = await this.store(currentDataUrl, sessionId, 'dom-mutation', diffRatio);
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
  ): Promise<string> {
    const id = crypto.randomUUID();
    const screenshot: StoredScreenshot = {
      id,
      sessionId,
      timestamp: Date.now(),
      dataUrl,
      width: 0,
      height: 0,
      trigger,
      diffPercent,
    };
    await this.deps.storeScreenshot(screenshot);
    return id;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd C:/Projects/web-tool/underpixel && pnpm test -- extension/lib/screenshot/pipeline.test.ts`
Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add extension/lib/screenshot/pipeline.ts extension/lib/screenshot/pipeline.test.ts
git commit -m "feat: implement ScreenshotPipeline with pixelmatch comparison and storage"
```

---

### Task 8: Wire screenshot gate + pipeline into background.ts

**Files:**

- Modify: `extension/entrypoints/background.ts`
- Modify: `extension/lib/tools/network.ts:16-94` (capture_start)
- Modify: `extension/lib/tools/network.ts:98-168` (capture_stop)

- [ ] **Step 1: Add screenshot gate and pipeline setup to capture_start**

In `extension/lib/tools/network.ts`, add imports at the top:

```typescript
import { ScreenshotGate } from '../screenshot/gate';
import { ScreenshotPipeline } from '../screenshot/pipeline';
```

Add module-level state for the active gate and pipeline:

```typescript
let activeGate: ScreenshotGate | null = null;
let activePipeline: ScreenshotPipeline | null = null;
```

In the `capture_start` handler, after the `chrome.tabs.sendMessage` block (after the rrweb recording start, around line 82), add:

```typescript
// Start screenshot gate + pipeline if enabled
if (config.screenshotsEnabled) {
  // Ensure offscreen document exists
  try {
    const hasDoc = await chrome.offscreen.hasDocument();
    if (!hasDoc) {
      await chrome.offscreen.createDocument({
        url: 'offscreen/index.html',
        reasons: [chrome.offscreen.Reason.CANVAS],
        justification: 'Screenshot pixel comparison via pixelmatch',
      });
    }
  } catch (err) {
    console.warn('[UnderPixel] Failed to create offscreen document:', err);
  }

  activePipeline = new ScreenshotPipeline({
    captureVisibleTab: async (tid: number) => {
      const t = await chrome.tabs.get(tid);
      if (t.windowId) {
        await chrome.windows.update(t.windowId, { focused: true });
      }
      return chrome.tabs.captureVisibleTab(t.windowId!, {
        format: 'jpeg',
        quality: 50,
      });
    },
    sendMessageToOffscreen: (msg) => chrome.runtime.sendMessage(msg),
    storeScreenshot: async (screenshot) => {
      const database = await db();
      await database.put('screenshots', screenshot);
    },
    getSession: async (sid) => {
      const database = await db();
      return database.get('sessions', sid);
    },
    pixelDiffThreshold: config.pixelDiffThreshold,
  });

  activeGate = new ScreenshotGate({
    screenshotInterval: config.screenshotInterval,
    maxScreenshotsPerSession: config.maxScreenshotsPerSession,
    pixelDiffThreshold: config.pixelDiffThreshold,
    onReady: async () => {
      if (!activePipeline) return;
      const result = await activePipeline.captureAndCompare(tabId, session.id);
      if (result.stored) {
        activeGate?.recordScreenshot();
      }
    },
    onNavigation: async () => {
      if (!activePipeline) return;
      const result = await activePipeline.captureNavigation(tabId, session.id);
      if (result.stored) {
        activeGate?.recordScreenshot();
      }
    },
  });
  activeGate.start();
}
```

- [ ] **Step 2: Export gate accessors for background.ts to use**

Add exports at the bottom of `extension/lib/tools/network.ts`:

```typescript
export function getActiveGate(): ScreenshotGate | null {
  return activeGate;
}
```

- [ ] **Step 3: Update capture_stop to clean up gate and offscreen**

In the `capture_stop` handler, after `stopCapture(tabId)` (around line 119), add:

```typescript
// Stop screenshot gate
if (activeGate) {
  activeGate.stop();
  activeGate = null;
}
if (activePipeline) {
  activePipeline.reset();
  activePipeline = null;
}

// Close offscreen document
try {
  const hasDoc = await chrome.offscreen.hasDocument();
  if (hasDoc) {
    await chrome.offscreen.closeDocument();
  }
} catch {
  // May already be closed
}
```

Also update the screenshot count in the session stats. After `session.stats.networkRequestCount = networkRequestCount;` add:

```typescript
// Use gate screenshot count if available, otherwise keep existing
if (activeGate) {
  session.stats.screenshotCount = activeGate.getScreenshotCount();
}
```

Note: this needs to happen _before_ the gate cleanup above. Reorder so the stats read comes first.

- [ ] **Step 4: Wire gate events in background.ts message handler**

In `extension/entrypoints/background.ts`, update the `handleContentMessage` function to also notify the gate. Add import at the top:

```typescript
import { getActiveGate } from '../lib/tools/network';
```

Update `handleContentMessage`:

```typescript
async function handleContentMessage(
  message: { type: string; payload: unknown },
  sender: chrome.runtime.MessageSender,
) {
  const tabId = sender.tab?.id;
  if (!tabId) return;

  const sessionId = getSessionId(tabId);
  if (!sessionId) return;

  if (message.type === 'rrweb') {
    const payload = message.payload as {
      event: { type: number; data: unknown; timestamp: number };
      isCheckout?: boolean;
    };

    const stored = {
      sessionId,
      timestamp: payload.event.timestamp,
      type: payload.event.type,
      data: payload.event.data,
    };

    enqueueRrwebEvent(sessionId, stored);

    // Notify screenshot gate
    getActiveGate()?.onEvent('rrweb');
  }

  if (message.type === 'layout-shift') {
    // Notify screenshot gate
    getActiveGate()?.onEvent('layout-shift');
  }
}
```

- [ ] **Step 5: Wire navigation event to gate in background.ts**

In the `chrome.tabs.onUpdated` handler in `background.ts`, after the rrweb restart `try/catch` block (around line 78), add:

```typescript
// Notify screenshot gate of navigation
getActiveGate()?.onNavigation();
```

- [ ] **Step 6: Run full test suite**

Run: `cd C:/Projects/web-tool/underpixel && pnpm test`
Expected: All tests pass.

- [ ] **Step 7: Build the extension**

Run: `cd C:/Projects/web-tool/underpixel && pnpm build`
Expected: Build succeeds with no errors.

- [ ] **Step 8: Commit**

```bash
git add extension/entrypoints/background.ts extension/lib/tools/network.ts
git commit -m "feat: wire screenshot gate + pipeline into capture lifecycle"
```

---

### Task 9: Add screenshot settings to popup UI

**Files:**

- Modify: `extension/entrypoints/popup/index.html`
- Modify: `extension/entrypoints/popup/main.ts`
- Modify: `extension/entrypoints/popup/style.css`

- [ ] **Step 1: Add screenshot settings HTML**

In `extension/entrypoints/popup/index.html`, add a new section after `capture-section` (after line 29):

```html
<section id="screenshot-section" class="hidden">
  <div class="settings-card">
    <h3>Screenshot Settings</h3>
    <label class="setting-row">
      <span>Auto-screenshots</span>
      <input type="checkbox" id="screenshots-enabled" checked />
    </label>
    <label class="setting-row">
      <span>Max per session</span>
      <input
        type="number"
        id="max-screenshots"
        value="100"
        min="1"
        max="1000"
        class="setting-input"
      />
    </label>
    <label class="setting-row">
      <span>Min interval (ms)</span>
      <input
        type="number"
        id="screenshot-interval"
        value="500"
        min="100"
        max="5000"
        step="100"
        class="setting-input"
      />
    </label>
    <label class="setting-row">
      <span>Diff threshold (%)</span>
      <input
        type="number"
        id="diff-threshold"
        value="1"
        min="0.1"
        max="50"
        step="0.1"
        class="setting-input"
      />
    </label>
  </div>
</section>
```

- [ ] **Step 2: Add CSS for settings**

In `extension/entrypoints/popup/style.css`, add at the end:

```css
/* ---- Screenshot Settings ---- */

.settings-card {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 12px;
}

.settings-card h3 {
  font-size: 13px;
  font-weight: 600;
  color: #2d3748;
  margin-bottom: 8px;
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 0;
  font-size: 12px;
  color: #4a5568;
}

.setting-input {
  width: 70px;
  padding: 3px 6px;
  border: 1px solid #cbd5e0;
  border-radius: 4px;
  font-size: 12px;
  text-align: right;
}
```

- [ ] **Step 3: Add settings load/save logic to main.ts**

In `extension/entrypoints/popup/main.ts`, add DOM references and load/save logic. Add after the existing DOM element declarations (after line 10):

```typescript
const screenshotSection = document.getElementById('screenshot-section')!;
const screenshotsEnabledEl = document.getElementById('screenshots-enabled')! as HTMLInputElement;
const maxScreenshotsEl = document.getElementById('max-screenshots')! as HTMLInputElement;
const screenshotIntervalEl = document.getElementById('screenshot-interval')! as HTMLInputElement;
const diffThresholdEl = document.getElementById('diff-threshold')! as HTMLInputElement;
```

Add a function to load settings from `chrome.storage.local`:

```typescript
async function loadScreenshotSettings() {
  const stored = await chrome.storage.local.get([
    'screenshotsEnabled',
    'maxScreenshotsPerSession',
    'screenshotInterval',
    'pixelDiffThreshold',
  ]);
  screenshotsEnabledEl.checked = stored.screenshotsEnabled ?? true;
  maxScreenshotsEl.value = String(stored.maxScreenshotsPerSession ?? 100);
  screenshotIntervalEl.value = String(stored.screenshotInterval ?? 500);
  diffThresholdEl.value = String((stored.pixelDiffThreshold ?? 0.01) * 100);
}
```

Add save handlers:

```typescript
function saveScreenshotSettings() {
  chrome.storage.local.set({
    screenshotsEnabled: screenshotsEnabledEl.checked,
    maxScreenshotsPerSession: parseInt(maxScreenshotsEl.value, 10) || 100,
    screenshotInterval: parseInt(screenshotIntervalEl.value, 10) || 500,
    pixelDiffThreshold: (parseFloat(diffThresholdEl.value) || 1) / 100,
  });
}

screenshotsEnabledEl.addEventListener('change', saveScreenshotSettings);
maxScreenshotsEl.addEventListener('change', saveScreenshotSettings);
screenshotIntervalEl.addEventListener('change', saveScreenshotSettings);
diffThresholdEl.addEventListener('change', saveScreenshotSettings);
```

In `updateState()`, show the screenshot section when connected:

```typescript
screenshotSection.classList.remove('hidden');
```

And hide it in the else branch:

```typescript
screenshotSection.classList.add('hidden');
```

Call `loadScreenshotSettings()` at the end of the file (before or after `updateState()`):

```typescript
loadScreenshotSettings();
```

- [ ] **Step 4: Build and verify**

Run: `cd C:/Projects/web-tool/underpixel && pnpm build`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add extension/entrypoints/popup/index.html extension/entrypoints/popup/main.ts extension/entrypoints/popup/style.css
git commit -m "feat: add screenshot settings UI to popup"
```

---

### Task 10: Update CLAUDE.md and run full verification

**Files:**

- Modify: `CLAUDE.md`

- [ ] **Step 1: Run full test suite**

Run: `cd C:/Projects/web-tool/underpixel && pnpm test`
Expected: All tests pass (should be ~146+ now with new gate + pipeline tests).

- [ ] **Step 2: Run lint**

Run: `cd C:/Projects/web-tool/underpixel && pnpm lint`
Expected: No errors.

- [ ] **Step 3: Run build**

Run: `cd C:/Projects/web-tool/underpixel && pnpm build`
Expected: Build succeeds. `.output/chrome-mv3/` contains offscreen files.

- [ ] **Step 4: Update Phase 2 status in CLAUDE.md**

Change the Phase 2 status line:

```markdown
- **Phase 2: COMPLETE** — Replay UI (Svelte + rrweb-player, event-based timeline, detail panel, search/filter, auto-scroll, speed control, session picker, copy cURL/JSON, ESC close, progress bar seek). Smart screenshot gate (2-layer: rrweb/layout-shift debounce + pixelmatch via offscreen document). Screenshot settings in popup + MCP tool override.
```

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: mark Phase 2 as complete"
```
