# Smart Screenshot Gate + Offscreen Document — Design Spec

**Date:** 2026-04-03
**Phase:** 2 (final piece)
**Goal:** Automatically capture screenshots on meaningful visual changes during capture sessions, using a 2-layer gate system with pixelmatch for pixel diff confirmation.

---

## Overview

Currently screenshots are manual-only via the `underpixel_screenshot` MCP tool. This design adds automatic screenshot capture that fires when the page visually changes during an active capture session. The system uses two layers:

1. **Layer 1 (Background — free):** Track rrweb events and layout-shift signals already flowing to the background service worker. Debounce 500ms. When no new events arrive for 500ms and the dirty flag is set, proceed to Layer 2.
2. **Layer 2 (Offscreen Document — ~10ms):** `captureVisibleTab` → send to offscreen document → pixelmatch against previous screenshot → store if diff > threshold, discard otherwise.

Navigation events bypass Layer 2 entirely — always capture immediately.

## Architecture

```
content-recorder.ts                    background.ts
  rrweb events ──────────────┐
  layout-shift ──────────────┤
                             ▼
                     Screenshot Gate (gate.ts)
                      dirty flag + debounce
                      "no events for 500ms"
                             │
                             ▼ ready
                     captureVisibleTab()
                             │
                             ▼
                     Offscreen Document
                      pixelmatch(prev, curr)
                             │
                     ┌───────┴────────┐
                     ▼ diff > 1%      ▼ diff ≤ 1%
                  Store screenshot    Discard
                  + correlation bundle
```

## Component 1: Screenshot Gate

**File:** `extension/lib/screenshot/gate.ts`

A class instantiated per capture session. Simple dirty flag + debounce timer — not a state machine.

### State

```typescript
dirty = false;
debounceTimer: ReturnType<typeof setTimeout> | null;
lastScreenshotTime = 0;
screenshotCount = 0;
```

Note: `previousScreenshotDataUrl` is managed by the background pipeline, not the gate. The gate only decides _when_ to fire — the pipeline manages screenshot storage and comparison state.

### API

- `onEvent(type: 'rrweb' | 'layout-shift')` — Sets dirty flag, resets debounce timer. Called by background when it receives content script messages.
- `onNavigation()` — Immediately triggers screenshot (skips Layer 2 / pixelmatch), resets dirty state. Navigation always warrants a capture.
- `start(config)` — Begins accepting events. Config includes `screenshotInterval`, `maxScreenshotsPerSession`, `pixelDiffThreshold`.
- `stop()` — Clears timers, resets state.
- `onReady: (callback) => void` — Fires when debounce expires (no events for 500ms) and dirty flag is set. Background wires this to trigger the capture pipeline.

### Guards before firing `onReady`

- `screenshotCount < maxScreenshotsPerSession`
- `Date.now() - lastScreenshotTime >= screenshotInterval`
- `dirty === true`

### Config source

Read from `chrome.storage.local` at capture start (popup-set defaults), merged with any overrides passed via `capture_start` MCP tool.

## Component 2: Offscreen Document

**Files:** `extension/entrypoints/offscreen/offscreen.html` + `offscreen.ts`

### Purpose

Receive two screenshot data URLs, draw to canvas, extract ImageData, run pixelmatch, return diff percentage. Service workers can't use Canvas/DOM, so this is required.

### Lifecycle

- **Created** at capture start via `chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['CANVAS'], justification: 'Screenshot pixel comparison' })`
- **Destroyed** at capture stop via `chrome.offscreen.closeDocument()`
- **Guard:** check `chrome.offscreen.hasDocument()` before creating (Chrome throws if one already exists)

### Message protocol

```typescript
// Background -> Offscreen
{
  type: 'pixel-diff',
  previous: string,  // data URL (JPEG)
  current: string,   // data URL (JPEG)
}

// Offscreen -> Background (response via sendResponse)
{
  diffRatio: number,  // 0.0 - 1.0 (changed pixels / total pixels)
}
```

### Implementation (~40 lines)

- Listen for `chrome.runtime.onMessage`
- Create two `Image` elements from data URLs
- Draw both to offscreen `<canvas>` elements
- `ctx.getImageData()` to get raw pixel arrays
- `pixelmatch(img1data, img2data, null, width, height, { threshold: 0.1 })` returns number of differing pixels
- Return `diffRatio = diffPixels / (width * height)`

### First screenshot

When `previous` is null (first capture in session), background skips the offscreen diff entirely and stores the screenshot directly.

## Component 3: Background Pipeline Integration

How the existing `background.ts` wires everything together.

### At capture start (`capture_start` tool)

1. Read screenshot config from `chrome.storage.local`, merge with MCP tool overrides
2. Create offscreen document (`chrome.offscreen.createDocument`)
3. Instantiate `ScreenshotGate` with config
4. Wire `gate.onReady` callback to the capture pipeline
5. Start gate

### On content script messages (already handled in background.ts)

- `message.type === 'rrweb'` → existing handling + `gate.onEvent('rrweb')`
- `message.type === 'layout-shift'` → existing handling + `gate.onEvent('layout-shift')`

### On navigation (`chrome.tabs.onUpdated` handler)

- Existing rrweb restart logic + `gate.onNavigation()`

### When gate fires `onReady`

1. `chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 50 })` → data URL
2. If first screenshot → store directly, set as `previousScreenshotDataUrl`
3. If not first → send `{ type: 'pixel-diff', previous, current }` to offscreen document
4. If `diffRatio > pixelDiffThreshold` → store screenshot in IndexedDB, attach to current/recent correlation bundle via timestamp matching, update `previousScreenshotDataUrl`, increment `screenshotCount`
5. If `diffRatio ≤ threshold` → discard, keep previous

### Error handling

If `captureVisibleTab` fails (tab minimized, chrome:// page, tab closed), log a warning, reset dirty flag, do not increment `screenshotCount`. The gate continues accepting events for the next opportunity.

### At capture stop (`capture_stop` tool)

1. `gate.stop()`
2. `chrome.offscreen.closeDocument()`

## Configuration

Added to `CaptureConfig` in `packages/shared/src/types.ts`:

```typescript
screenshotsEnabled: boolean; // default: true
maxScreenshotsPerSession: number; // default: 100
screenshotInterval: number; // default: 500 (ms)
pixelDiffThreshold: number; // default: 0.01 (1%)
```

Both popup UI and `capture_start` tool can set these:

- **Popup** writes defaults to `chrome.storage.local`
- **`capture_start`** accepts optional `screenshotConfig` param that overrides for that session

## Files to create

- `extension/lib/screenshot/gate.ts` — Screenshot gate class
- `extension/entrypoints/offscreen/offscreen.html` — Minimal HTML for offscreen document
- `extension/entrypoints/offscreen/offscreen.ts` — pixelmatch canvas logic

## Files to modify

- `extension/entrypoints/background.ts` — Wire gate events, create/destroy offscreen document, capture pipeline
- `extension/lib/network/capture.ts` — Accept screenshot config in capture start, pass to gate
- `extension/lib/tools/network.ts` — Add `screenshotConfig` param to `capture_start` tool schema
- `packages/shared/src/types.ts` — Add screenshot config fields to `CaptureConfig`
- `packages/shared/src/tool-schemas.ts` — Update `capture_start` schema with screenshot config
- `packages/shared/src/constants.ts` — Add screenshot config defaults
- `extension/entrypoints/popup/` — Add screenshot settings UI (toggles/sliders)
- `extension/package.json` — Add `pixelmatch` dependency

## Testing

- Unit tests for `gate.ts`: debounce behavior, guards (max count, interval), navigation bypass, start/stop lifecycle
- Unit tests for offscreen message handling (mock pixelmatch)
- Integration: verify screenshots are stored in IndexedDB during capture with auto-gate
- Integration: verify `screenshotCount` respects `maxScreenshotsPerSession`
- Integration: verify navigation triggers immediate capture without pixelmatch
