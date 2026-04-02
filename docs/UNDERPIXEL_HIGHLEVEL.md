# UnderPixel

**"Record, replay, and understand what's behind the pixels"**

A Chrome extension + MCP server that gives AI coding assistants (Claude Code, Cursor, etc.) **timestamped visual-API correlation** — the ability to understand which API calls feed which UI elements, record browser sessions (human or AI-driven), and replay them with a synchronized API timeline.

Inspired by Undertale. Use pixel-art style branding/logo (think: a small pixel-art detective peeking under a lifted pixel tile, revealing network data flowing underneath, 8-bit color palette).

---

## Table of Contents

- [Origin Story & Motivation](#origin-story--motivation)
- [What Makes UnderPixel Different](#what-makes-underpixel-different)
- [Competitive Landscape](#competitive-landscape)
- [Architecture](#architecture)
- [Key Dependencies](#key-dependencies)
- [Feature Scope](#feature-scope)
- [What Gets Captured: Network vs Screenshots](#what-gets-captured-network-vs-screenshots)
- [API Dependency Graph Algorithm](#api-dependency-graph-algorithm)
- [MCP Tool Surface](#mcp-tool-surface)
- [Extension UI](#extension-ui)
- [Installation UX](#installation-ux)
- [Scalability Plan](#scalability-plan)
- [Build Phases](#build-phases)
- [GitHub Repo Setup](#github-repo-setup)
- [Credits & Licensing](#credits--licensing)
- [Design Decisions Log](#design-decisions-log)

---

## Origin Story & Motivation

The idea started from a personal use case: wanting Claude Code to open a company OKR system website, fetch OKRs, and save them to a doc platform with improvement ideas appended.

The initial approach was to use a browser automation tool (dev-browser), but that required teammates to install extra tooling. Since Chrome extensions can call APIs with cookies/headers auto-attached, the idea shifted to: build a lightweight Chrome extension that captures API details and sends them to Claude Code for processing.

This evolved into a broader vision: not just capture network calls, but **correlate them with what the user sees on screen** — timestamped visual-API correlation that no existing tool provides.

## What Makes UnderPixel Different

The core differentiator is **timestamped visual-API correlation**. Existing tools treat network capture and visual capture as separate, unlinked streams. UnderPixel bundles them:

```
Snapshot Bundle @ T=1712345678000:
  - screenshot: PNG
  - dom_state: rrweb incremental snapshot
  - api_calls: [
      { url, method, status, requestHeaders, requestBody,
        responseHeaders, responseBody, startTime, endTime },
      ...
    ]
  - trigger: "fetch response: GET /api/okrs"
  - correlation: "DOM element #okr-table updated with data from GET /api/okrs"
```

Secondary differentiators:
1. **Works in your real browser** — no special Chrome flags, no separate profiles. Cookies and auth just work. (chrome-devtools-mcp requires `--remote-debugging-port` with a separate profile, or Chrome 144+ `--autoConnect`)
2. **Records AI agent actions** — when Claude Code navigates/clicks/fills via MCP, UnderPixel silently records everything. Users can replay what the AI did, with full API details. This is an audit/observability angle nobody else offers.
3. **Focused tool surface** — ~12 MCP tools instead of 27 (mcp-chrome). Opinionated, not a Swiss army knife.
4. **Session replay with API timeline** — rrweb-player with synchronized API call panel. Visual product, not just a CLI pipe.

## Competitive Landscape

### Tools Evaluated

| Tool | Stars | Network Bodies | Screenshots | Works in Real Browser | Visual-API Correlation | Status |
|------|-------|---------------|-------------|----------------------|----------------------|--------|
| **Claude in Chrome** (Anthropic official) | N/A | No | Yes | Yes | No | Active (beta) |
| **ChromeDevTools/chrome-devtools-mcp** (Google) | ~32.8k | Yes | Yes | No (needs flags/separate profile) | No | Very Active |
| **hangwin/mcp-chrome** | ~11.1k | Yes (Debugger mode) | Yes | Yes | No | Active |
| **AgentDeskAI/browser-tools-mcp** | ~7.2k | Partial | Yes | Yes | No | **Abandoned** |
| **Saik0s/mcp-browser-use** | ~917 | Yes (auto-identifies key calls) | Partial | No | Partial (skills concept) | Active |
| **benjaminr/chrome-devtools-mcp** | ~293 | Yes (filterable) | No | No | No | Active |
| **Eddym06/chrome-devTools-advanced-mcp** | ~4 | Best (HAR, replay, WebSocket) | Yes | No | No | Active |
| **nicobailon/surf-cli** | ~373 | Yes + replay | Yes (annotated) | Yes | No | Active (not MCP) |
| **UnderPixel** (this project) | — | Yes | Yes | Yes | **Yes** | Building |

### Key Gap Analysis vs mcp-chrome (closest competitor)

| Capability | mcp-chrome | UnderPixel |
|---|---|---|
| Network capture with response bodies | Yes (Debugger mode) | Yes (chrome.debugger, referencing mcp-chrome patterns) |
| Screenshots | Yes | Yes (captureVisibleTab, referencing mcp-chrome patterns) |
| Network-to-DOM correlation | **No** | **Yes** |
| DOM mutation tracking | **No** | **Yes** (rrweb) |
| Visual change detection | **No** | **Yes** (2-layer system: rrweb + pixelmatch) |
| Timeline/timestamp correlation | **No** | **Yes** |
| Session replay | **No** | **Yes** (rrweb-player) |
| API dependency graph | **No** | **Yes** |
| AI action audit trail | **No** | **Yes** |
| Session export/share | **No** | **Yes** (.underpixel files) |
| Request cap | 100 hard limit | Configurable, IndexedDB-backed |
| Tool count | 27 | ~12 (focused) |

### Why Not Just Use mcp-chrome?

- mcp-chrome is a browser automation Swiss army knife. UnderPixel is a focused understanding tool.
- mcp-chrome's network and visual captures are completely separate silos with no correlation.
- mcp-chrome has no DOM recording, no replay, no visual change detection, no dependency graphing.
- UnderPixel builds on mcp-chrome's infrastructure (MIT licensed) but adds the correlation layer as a first-class feature.

## Architecture

```
+----------------------------------------------------------+
|  Chrome Extension                                         |
|                                                           |
|  Content Script                                           |
|  +- rrweb.record()            -> DOM events stream        |
|  |   (also serves as DOM change signal — smart mutation   |
|  |    batching built in, no separate MutationObserver)    |
|  +- PerformanceObserver       -> layout-shift signals     |
|                                                           |
|  Background Service Worker                                |
|  +- chrome.debugger API       -> network capture          |
|  |   (request/response headers + bodies)                  |
|  +- Correlation Engine        -> match by timestamp       |
|  |   "API response T=1200 -> DOM mutations T=1250"        |
|  +- Screenshot Gate                                       |
|  |   rrweb events + layout-shift -> pixelmatch            |
|  +- Native Messaging client   -> sends to bridge          |
|  +- Data Storage (IndexedDB)  -> sessions, snapshots      |
|                                                           |
|  Popup                                                    |
|  +- Toggle capture on/off, filter settings                |
|                                                           |
|  Offscreen Document                                       |
|  +- Canvas image processing (hash, diff)                  |
|                                                           |
|  Extension Page (replay.html, opened as chrome tab)       |
|  +- rrweb-player (left pane)                              |
|  +- API timeline (right pane, synced by timestamp)        |
|  +- API dependency graph view                             |
|                                                           |
+----------------------------+------------------------------+
                             |
                    Native Messaging
                             |
+----------------------------+------------------------------+
|  Bridge (underpixel-bridge, npm package)                  |
|  +- stdio <-> Native Messaging translator                 |
|  +- Auto-registers as Chrome Native Messaging host        |
|  +- ~100-200 lines, intentionally dumb pipe               |
+----------------------------+------------------------------+
                             |
                         stdio (MCP JSON-RPC)
                             |
+----------------------------+------------------------------+
|  Claude Code / Any MCP Client                             |
|  Calls MCP tools, does analysis                           |
+----------------------------------------------------------+
```

**Key architectural decision**: All logic lives in the Chrome extension. The bridge is a dumb pipe. This means:
- Updating the extension (via Web Store auto-update) updates the logic
- The npm bridge package rarely needs updating
- The extension holds all state — no syncing issues

## Key Dependencies

| Library | License | Purpose | Why This One |
|---------|---------|---------|-------------|
| **[rrweb](https://github.com/rrweb-io/rrweb)** | MIT | DOM snapshot + incremental recording + replay | 17k stars, mature, smart mutation batching (only records final value per batch, discards transient nodes) |
| **[rrweb-player](https://github.com/rrweb-io/rrweb/tree/master/packages/rrweb-player)** | MIT | Session replay UI component | Built into rrweb ecosystem, has play/pause/seek |
| **[mcp-chrome](https://github.com/hangwin/mcp-chrome)** | MIT | **Reference implementation** (not an npm dependency). We study and reference their patterns for: Debugger API network capture, screenshot pipeline, Native Messaging bridge architecture, Streamable HTTP MCP server | 11k stars, battle-tested patterns for the hard infrastructure problems |
| **[@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk)** | MIT | MCP server implementation | Official SDK |
| **[pixelmatch](https://github.com/mapbox/pixelmatch)** | ISC | Pixel-level image comparison for screenshot gate | 150 lines, zero deps, stable algorithm, runs on raw ImageData in browser |
| **[elkjs](https://github.com/kieler/elkjs)** | EPL-2.0 | Graph layout for API dependency DAG | 2k stars, computes node positions from edge list. For extension UI only, not v1 priority |

**Removed from consideration:**
- ~~blockhash-core~~ — removed. rrweb's event stream + PerformanceObserver already filter 90%+ of noise at Layer 1. Adding a perceptual hash layer is over-engineering. Last updated ~2019.
- ~~mutation-summary~~ — removed. rrweb already does smart mutation batching (only records final value per batch, discards transient nodes). Running a parallel MutationObserver is redundant. Last updated ~2017.

### Browser APIs Used

| API | Purpose |
|-----|---------|
| `chrome.debugger` | Network capture with full request/response bodies (CDP: `Network.requestWillBeSent`, `Network.responseReceived`, `Network.getResponseBody`) |
| `chrome.tabs.captureVisibleTab` | Screenshots. **Rate limited to 2 calls/sec** (hard Chrome limit since v92) |
| `chrome.offscreen` | Offscreen document for canvas-based image processing (service workers can't use DOM/Canvas) |
| `chrome.contextMenus` | Right-click menu items (future use) |
| `chrome.runtime.connectNative` | Native Messaging to bridge |
| `PerformanceObserver("layout-shift")` | Browser-native visual change signal |
| `requestIdleCallback` | Detect when page is idle/stable |
| `IndexedDB` | Store session data, rrweb events, network captures |

## Feature Scope

### In Scope

1. **Network capture with full details** — request/response headers, bodies, timing, via chrome.debugger API
2. **DOM recording** — rrweb full snapshot + incremental diffs
3. **Timestamped visual-API correlation** — bundle network events with DOM changes and screenshots by timestamp proximity
4. **Smart screenshot capture** — 2-layer gate system (rrweb events + stability wait -> pixelmatch diff)
5. **Replay UI** — rrweb-player in extension tab page with synced API call timeline panel
6. **API dependency graph** — auto-detect call chains via value propagation tracking
7. **MCP server** — ~12 focused tools for Claude Code / any MCP client
8. **Session export/share** — `.underpixel` files (gzipped JSON: rrweb events + network + screenshots)
9. **API diff between sessions** — compare production vs staging API calls + visual differences
10. **Auto-generate API documentation** — from captured sessions, generate endpoint docs with auth flow, params, response shape
11. **Performance annotations** — slow API calls highlighted, waterfall visualization, time-to-interactive markers
12. **AI action recording** — silently records when Claude Code drives the browser, enabling replay + audit
13. **User controls** — popup toggle on/off, filter settings
14. **Browser control** — navigate, click, fill, scroll (from mcp-chrome, minimal set)

### Excluded from Scope

- **"Explain This Page" right-click** — excluded because MCP is pull-based (Claude Code calls tools, can't receive push). Could revisit when Claude Code adds push/notification support. Workaround exists (queue + poll) but too janky for v1.
- **Bookmarks, history search, file upload/download** — mcp-chrome has these but they're outside UnderPixel's focus
- **GIF recording** — mcp-chrome feature, not relevant
- **Performance tracing** — mcp-chrome feature, outside scope (performance annotations are simpler and sufficient)
- **Safari support** — completely different extension model (Xcode/Swift), not worth it

## What Gets Captured: Network vs Screenshots

**Important distinction**: Network capture and screenshot capture are independent concerns with different strategies.

### Network Capture — record everything (configurable)

All network calls are **always recorded** via `chrome.debugger` (CDP). This is cheap (just metadata + bodies in IndexedDB) and is the foundation for correlation, dependency graphing, and API documentation.

Default filter: **XHR/fetch only** (excludes images, CSS, JS, fonts, media). User can configure:
- Include/exclude static resources
- Include/exclude specific domains
- Exclude analytics/tracking domains (configurable blocklist, sensible defaults like Google Analytics, Mixpanel, etc.)

Network capture is not gated or throttled — every matching request is recorded with full details.

### Screenshot Capture — smart and selective (2-Layer Gate)

Screenshots are expensive (`captureVisibleTab` is rate-limited to **2 calls/sec** by Chrome) and large (100KB-1MB each). The 2-layer gate decides **when a screenshot is worth taking**.

#### Why 2 layers, not 4

Originally designed as a 4-layer system (DOM triage -> stability wait -> perceptual hash -> pixel diff). Simplified after realizing:
- rrweb already does smart mutation batching (only records final values, discards transient nodes) — no need for a separate MutationObserver + mutation-summary library
- rrweb's event stream naturally serves as the "something changed" signal — no need for a separate DOM triage layer
- blockhash-core (perceptual hashing) adds a layer between "something changed" and "did pixels change" that isn't worth the complexity — if Layer 1 says something changed and the page is stable, just run pixelmatch directly

#### Layer 1: Change Detection + Stability Wait (Content Script, ~0 cost)

**Change signals** (any of these sets a dirty flag):
- rrweb emits incremental snapshot events (DOM changed)
- `PerformanceObserver("layout-shift")` fires (elements moved)
- URL/hash changed (navigation — always capture, skip Layer 2)
- API response received (XHR/fetch, filtered — only if rrweb also reports DOM mutations within the debounce window)

**Stability gate** (wait for all of these before proceeding):
- Layout-shift events have stopped
- `transitionend` / `animationend` fired (CSS animations settled)
- `requestIdleCallback` triggered (browser is idle)

**Debounce**: dirty flag checked every 500ms. Multiple triggers within that window = one check.

#### Layer 2: Pixel Diff (Offscreen Document, ~10ms)

```
captureVisibleTab
  -> pixelmatch against previous screenshot
  -> changedPixels / totalPixels > threshold (configurable, default ~1%)
  -> If significant, SAVE the screenshot + create correlated bundle
  -> If not significant, skip (DOM changed but pixels didn't)
```

#### Screenshot Limits (configurable)

| Setting | Default | Description |
|---------|---------|-------------|
| `maxScreenshotsPerSession` | 100 | Hard cap per capture session (per capture start/stop cycle). Prevents runaway storage on long-lived pages. When reached, only on-demand screenshots via MCP tool are allowed. |
| `screenshotInterval` | 500ms | Minimum time between screenshots (debounce). Cannot exceed Chrome's 2/sec hard limit regardless. |
| `pixelDiffThreshold` | `"auto"` | `"auto"` (default): skip pixel diff entirely — if Layer 1 says DOM changed and page is stable, save the screenshot. This is simpler and sufficient in most cases. Set to a number (e.g., `0.01` = 1%) to enable pixelmatch comparison and only save when enough pixels changed. |
| `screenshotsEnabled` | true | Master toggle. User can disable auto-screenshots entirely and rely only on on-demand capture via MCP tool or rrweb DOM replay. |

**Note on defaults**: These are starting guesses — tune based on real-world testing across different site types (dashboards, SPAs, form-heavy apps, content pages). The important thing is that they're configurable. In `"auto"` mode, Layer 2 (pixelmatch) is skipped entirely, making it effectively a 1-layer system where rrweb + stability gate is the only decision point.

Note: On-demand screenshots via the `underpixel_screenshot()` MCP tool always work regardless of these limits — these settings only control the automatic smart capture.

## API Dependency Graph Algorithm

Simple value propagation tracking. No external library needed for the algorithm itself.

### Core Logic

```javascript
function extractTrackableValues(responseBody) {
  const values = new Set();
  // Walk JSON recursively
  JSON.walk(responseBody, (key, value) => {
    if (typeof value === 'string') {
      if (value.length > 20) values.add(value);           // Tokens, long strings
      if (value.match(/^eyJ/)) values.add(value);         // JWT patterns
      if (value.match(/^[0-9a-f-]{36}$/i)) values.add(value); // UUIDs
    }
    if (typeof value === 'number' && key.match(/id$/i)) {
      values.add(String(value));                           // Numeric IDs
    }
  });
  return values;
}

function findDependencies(completedRequests) {
  const edges = [];
  for (let i = 0; i < completedRequests.length; i++) {
    const source = completedRequests[i];
    const trackableValues = extractTrackableValues(source.responseBody);
    for (let j = i + 1; j < completedRequests.length; j++) {
      const target = completedRequests[j];
      const searchSpace = [
        target.url,
        target.headers?.authorization,
        JSON.stringify(target.requestBody)
      ].join(' ');
      for (const value of trackableValues) {
        if (searchSpace.includes(value)) {
          edges.push({
            from: source.url, to: target.url,
            via: value.substring(0, 20) + '...',
            type: guessType(value) // "bearer_token", "id", "session"
          });
          break;
        }
      }
    }
  }
  return edges;
}
```

### Performance

- 50 API calls -> 1,225 pair comparisons -> < 10ms
- 200 API calls -> 19,900 comparisons -> < 100ms
- Scales fine for real-world sessions

### Visualization

For the extension UI, use [elkjs](https://github.com/kieler/elkjs) to compute layout positions from the edge list, render with SVG or Canvas. This is a v2/v3 UI feature — for v1, returning the edge list as JSON to Claude Code is sufficient.

## MCP Tool Surface

~12 focused tools, organized by purpose:

### Core (the differentiator)

| Tool | Description |
|------|-------------|
| `underpixel_correlate(query)` | "What API feeds the user table?" — cross-references DOM content with API responses |
| `underpixel_timeline(timeRange?)` | Returns snapshot bundles with correlated API + visual state |
| `underpixel_snapshot_at(timestamp)` | Screenshot + DOM state + API calls at a specific moment |

### Network

| Tool | Description |
|------|-------------|
| `underpixel_capture_start(filter?)` | Start recording network + DOM + visual state |
| `underpixel_capture_stop()` | Stop capture, return correlated summary |
| `underpixel_api_calls(filter?)` | Query captured API calls with full details (headers, bodies, timing) |
| `underpixel_api_dependencies()` | Auto-detected API call chain / dependency graph |

### Visual

| Tool | Description |
|------|-------------|
| `underpixel_screenshot(selector?)` | On-demand screenshot (viewport, full page, or element) |
| `underpixel_dom_text(selector)` | Current text content of elements |
| `underpixel_replay(timeRange)` | Opens replay tab in browser, returns session data |

### Browser Control (minimal, from mcp-chrome)

| Tool | Description |
|------|-------------|
| `underpixel_navigate(url)` | Go to page |
| `underpixel_interact(action)` | Click, fill, scroll |
| `underpixel_page_read()` | Accessibility tree of visible elements |

## Extension UI

The Chrome extension opens a full tab (`chrome.runtime.getURL("replay.html")`) for the replay interface:

```
+------------------------------+-------------------------+
|                              | > GET /api/okrs    1.2s |
|   rrweb-player               |   200 - 3 items         |
|   (interactive replay)       |                         |
|                              | > GET /api/user    0.3s |
|  [click element in replay    |   200 - profile data    |
|   -> highlights which API]   |                         |
|                              | > POST /api/log    0.1s |
|                              |   204 - no content      |
+------------------------------+                         |
| <<  >  >>  1x  ===*======   | [filter] [export]       |
+------------------------------+-------------------------+
```

Features:
- Left pane: rrweb-player with play/pause/seek controls
- Right pane: API call timeline, synced by timestamp
- Click an API call -> replay seeks to that moment
- Click UI element in replay -> highlights which API call fed it
- Export button -> saves .underpixel file
- API dependency graph view (v2, using elkjs)

## Installation UX

Follows the same proven pattern as mcp-chrome.

### Step 1: Install underpixel-bridge globally

```bash
# npm
npm install -g underpixel-bridge

# pnpm
pnpm config set enable-pre-post-scripts true
pnpm install -g underpixel-bridge

# If automatic registration fails (pnpm):
underpixel-bridge register
```

The bridge auto-registers itself as a Chrome Native Messaging host via a postinstall script.

### Step 2: Load Chrome Extension

- Download latest extension from [GitHub Releases](https://github.com/user/underpixel/releases)
- Open Chrome, go to `chrome://extensions/`
- Enable "Developer mode"
- Click "Load unpacked" and select the downloaded extension folder
- Click the extension icon, then click "Connect" to see MCP configuration

(Once stable, publish to Chrome Web Store for one-click install.)

### Step 3: Configure MCP Client

**Streamable HTTP (recommended):**
```json
{
  "mcpServers": {
    "underpixel": {
      "type": "streamableHttp",
      "url": "http://127.0.0.1:PORT/mcp"
    }
  }
}
```

**stdio (alternative):**
```json
{
  "mcpServers": {
    "underpixel": {
      "command": "npx",
      "args": ["-y", "underpixel-bridge"]
    }
  }
}
```

Works with Claude Code, Claude Desktop, Cursor, VS Code Copilot, Windsurf, or any MCP client.

## Scalability Plan

### MCP Client Agnostic

The MCP protocol is client-agnostic. The bridge speaks stdio JSON-RPC. Works with:
- Claude Code
- Claude Desktop
- Cursor
- VS Code Copilot
- Windsurf
- Any future MCP client

No extra work needed — this is free from the architecture choice.

### Cross-Browser

| Browser | Effort | Notes |
|---------|--------|-------|
| Chrome | Now | Primary target |
| Edge | Near-free | Same Chromium APIs, same Web Store |
| Arc, Brave, Opera | Near-free | Chromium-based |
| Firefox | Medium (v2) | WebExtensions ~90% compatible. Main gap: `chrome.debugger` doesn't exist, use `browser.devtools.network` instead. Native Messaging slightly different manifest. |
| Safari | Hard | Not planned. Different extension model entirely (Xcode/Swift). |

**Key for cross-browser**: abstract browser-specific APIs behind interfaces from day one:
```typescript
interface NetworkCapture {
  start(filter: CaptureFilter): void;
  stop(): CapturedData;
}
// Chrome implementation uses chrome.debugger
// Firefox implementation uses browser.devtools.network
```

### Data Scalability

| Concern | Solution |
|---------|----------|
| Memory bloat from long sessions | Stream rrweb events to IndexedDB, not memory |
| Large response bodies | Store in IndexedDB, return summaries to MCP, full body on-demand |
| Query performance | Index by timestamp + URL pattern in IndexedDB |
| Export file size | Compress `.underpixel` files with gzip (rrweb events compress ~10:1) |
| Request cap | Configurable (unlike mcp-chrome's hard 100 limit) |

## Build Phases

### Phase 1: Core MVP (~4-5 days)

**Goal**: Network capture + correlation + MCP tools working end-to-end.

1. **Project scaffold** — Chrome extension (Manifest V3) + bridge npm package
2. **Network capture** — `chrome.debugger` API for full request/response/headers/body capture (reference mcp-chrome's Debugger mode implementation)
3. **rrweb integration** — `rrweb.record({ emit(event) {...} })` in content script, store events in IndexedDB
4. **Correlation engine** — timestamp-based matching: group API responses with DOM mutations within configurable window (e.g., 500ms)
5. **Basic screenshot** — `captureVisibleTab` on-demand (no smart gate yet)
6. **Native Messaging bridge** — stdio <-> Native Messaging translator, auto-registration
7. **MCP tools** — implement core tools: `capture_start`, `capture_stop`, `api_calls`, `screenshot`, `navigate`, `interact`, `page_read`, `correlate`
8. **Basic popup** — toggle capture on/off

**Deliverable**: User can tell Claude Code "go to X page, capture network, tell me what API feeds the user list" and get a correlated answer.

### Phase 2: Smart Capture + Replay UI (~3-4 days)

**Goal**: Visual change detection + replay interface.

1. **2-layer screenshot gate** — rrweb events + PerformanceObserver + stability wait, then pixelmatch for pixel diff confirmation
2. **Offscreen document** — canvas-based image processing for hash/diff
3. **Replay page** — `replay.html` with rrweb-player left pane + API timeline right pane
4. **Timeline sync** — click API call -> seek replay, play replay -> highlight current API calls
5. **MCP tools** — implement `timeline`, `snapshot_at`, `replay`
6. **DOM text tool** — `underpixel_dom_text(selector)` for quick text extraction

**Deliverable**: User can replay browser sessions with synchronized API timeline. Smart screenshots captured automatically on significant visual changes.

### Phase 3: Dependency Graph + Export (~2-3 days)

**Goal**: API chain detection + session sharing.

1. **Value propagation algorithm** — extract trackable values from responses, match in subsequent requests
2. **MCP tool** — `api_dependencies()` returns edge list
3. **Session export** — `.underpixel` file format (gzipped JSON bundle)
4. **Session import** — open .underpixel file in replay UI without needing original site
5. **Export button** in replay UI

**Deliverable**: Claude Code can query API auth flows. Users can export and share sessions with teammates.

### Phase 4: Advanced Features (~3-4 days)

**Goal**: Diff, auto-docs, performance, polish.

1. **API diff between sessions** — compare two .underpixel files: new/removed calls, changed response shapes, visual differences (side-by-side replay)
2. **Auto-generate API documentation** — from captured sessions, generate endpoint docs with auth flow, params, response shape (Claude Code refines into OpenAPI spec)
3. **Performance annotations** — overlay on replay: slow API calls highlighted red, waterfall visualization, parallel vs sequential request markers
4. **Dependency graph UI** — visual DAG in extension page using elkjs
5. **Filter improvements** — filter by domain, status code, resource type, URL pattern
6. **Polish** — error handling, edge cases, loading states

### Phase 5: Cross-Browser + Ecosystem (~ongoing)

1. **Edge support** — test and publish to Edge Add-ons store
2. **Firefox port** — replace `chrome.debugger` with `browser.devtools.network`, adjust Native Messaging manifest
3. **Browser API abstraction layer** — if not done already
4. **Community features** — based on user feedback

## GitHub Repo Setup

### Repository

- **Name**: `underpixel`
- **Description**: Chrome extension + MCP server — record, replay, and understand what's behind the pixels. Timestamped visual-API correlation for Claude Code and any MCP client.
- **Topics**: `chrome-extension`, `claude-code`, `mcp`, `mcp-server`, `devtools`, `network-debugging`, `api-monitoring`, `rrweb`, `browser-automation`, `developer-tools`

### Repo Structure (suggested)

```
underpixel/
+-- extension/               # Chrome extension
|   +-- manifest.json        # Manifest V3
|   +-- src/
|   |   +-- content/         # Content scripts (rrweb recording, PerformanceObserver)
|   |   +-- background/      # Service worker (debugger API, correlation engine, screenshot gate)
|   |   +-- offscreen/       # Offscreen document (canvas image processing)
|   |   +-- popup/           # Extension popup (toggle, settings)
|   |   +-- replay/          # Replay page (rrweb-player + API timeline)
|   |   +-- shared/          # Shared types, constants, utils
|   +-- assets/              # Icons, pixel art
|   +-- build/               # Build config
+-- bridge/                  # NPM package (underpixel-bridge)
|   +-- src/
|   |   +-- index.ts         # stdio <-> Native Messaging translator
|   |   +-- register.ts      # Auto-register as Native Messaging host
|   +-- package.json
+-- docs/                    # Documentation
+-- README.md
+-- LICENSE                  # MIT
```

### README Structure

```
# UnderPixel
> Record, replay, and understand what's behind the pixels

[badges: Chrome Web Store, npm, license, stars]

[One-paragraph description]
[GIF/screenshot of replay UI with API timeline]

## What it does
[3 bullet points with visuals]

## Quick Start
[2-step install: extension + MCP config]

## Features
[Feature list with screenshots]

## How it works
[Architecture diagram]

## MCP Tools Reference
[Tool table]

## Acknowledgments
[Credits to mcp-chrome and rrweb]
```

## Credits & Licensing

### License

MIT — matches both mcp-chrome and rrweb.

### Acknowledgments

```markdown
## Acknowledgments

UnderPixel builds on the excellent work of:
- [mcp-chrome](https://github.com/hangwin/mcp-chrome) by hangwin —
  browser MCP infrastructure, network capture, screenshot pipeline
- [rrweb](https://github.com/rrweb-io/rrweb) —
  DOM recording and replay

Both are MIT licensed. UnderPixel adds timestamped visual-API
correlation on top of their foundations.
```

## Design Decisions Log

### 1. Build on mcp-chrome + rrweb, not from scratch
**Why**: mcp-chrome already solved Native Messaging bridge, network capture (dual WebRequest + Debugger backends), screenshot pipeline, full-page stitching, browser automation. Rebuilding that is months. rrweb solved efficient DOM recording with smart mutation batching. Both are MIT licensed. UnderPixel's novel contribution is the correlation layer.

### 2. All logic in extension, bridge is a dumb pipe
**Why**: Extension auto-updates via Web Store. NPM package rarely needs updating. No state syncing issues. Single source of truth.

### 3. Chrome extension cannot host MCP server directly
**Why**: Manifest V3 service workers cannot bind to network ports (no HTTP server, no WebSocket server). MCP requires either accepting incoming connections (Streamable HTTP) or being spawned as a subprocess (stdio). A separate bridge process is required. Every existing tool (Claude in Chrome, mcp-chrome, BrowserMCP) uses this pattern.

### 4. Event-driven capture, not interval-based
**Why**: `captureVisibleTab` is rate-limited to 2/sec. Interval-based wastes the budget on unchanged states. Event-driven (API response -> DOM mutation -> stability -> hash check) captures only meaningful changes.

### 5. 2-layer screenshot gate (simplified from original 4-layer design)
**Why**: Originally designed as 4 layers (DOM triage -> stability wait -> perceptual hash -> pixel diff). Simplified because rrweb already handles smart mutation batching — it only records final values per batch and discards transient nodes, making a separate MutationObserver + mutation-summary library redundant. blockhash-core (perceptual hashing, last updated ~2019) added complexity between "something changed" and "did pixels change" that wasn't justified. Final design: Layer 1 uses rrweb's event stream + PerformanceObserver as change signal + stability gate (free, already running), Layer 2 uses pixelmatch for pixel diff confirmation (~10ms). Simple, fewer dependencies, rrweb does the heavy lifting.

### 6. ~12 MCP tools, not 27
**Why**: Focused > comprehensive. Users don't need bookmarks, history search, GIF recording, performance tracing from a correlation tool. Fewer tools = less token overhead in MCP tool definitions = more context for actual work.

### 7. Name: UnderPixel
**Why**: Inspired by Undertale (pixel art aesthetic for branding). Evocative ("what's under the pixels") rather than descriptive. Short, memorable, works as package name (`underpixel`), repo name, extension name. Brand keywords (chrome, claude-code, mcp) go in repo description and GitHub topics, not the name — names age poorly with brand ties.

### 8. "Explain This Page" excluded from v1
**Why**: MCP is pull-based — Claude Code calls tools, extension can't push to Claude Code. Workarounds exist (queue + poll, clipboard, file drop) but all feel janky. Revisit when MCP or Claude Code adds push/notification support.

### 9. IndexedDB for data storage, not in-memory
**Why**: Long sessions with hundreds of API calls + rrweb events will exhaust memory. IndexedDB handles large datasets, persists across service worker restarts (Manifest V3 service workers have 30s idle timeout, 5min activity limit unless Native Messaging is active), and enables query by timestamp/URL pattern.

### 10. Correlation window approach (timestamp proximity)
**Why**: Simple rule — group events within a configurable window (e.g., 500ms). "API response at T=1200ms + DOM mutations at T=1220ms + screenshot at T=1300ms = one correlated bundle." ~50 lines of logic. No complex data flow analysis needed for v1. The LLM (Claude Code) can do deeper reasoning on top of the correlated data.

### 11. chrome.debugger (CDP) required for network capture
**Why**: The `chrome.webRequest` API can capture request headers/bodies but **cannot access response content**. Since "what data did this API return" is core to correlation, Debugger mode is required. Tradeoff: shows "Chrome is being controlled by automated test software" banner and conflicts with DevTools if open simultaneously. This is acceptable — mcp-chrome has the same limitation and 11k users live with it.

### 12. mcp-chrome is a reference implementation, not an npm dependency
**Why**: mcp-chrome is a Chrome extension, not a reusable library. We study and reference their implementation patterns (Debugger API capture, Native Messaging bridge, screenshot stitching, Streamable HTTP MCP server) and write our own code following similar approaches. Their code is MIT licensed. rrweb, on the other hand, IS an npm dependency (`npm install rrweb`) used directly.

### 13. IndexedDB for storage is browser-native, no extra dependencies
**Why**: IndexedDB is built into every browser — no library needed, no installation. It's the standard way Chrome extensions store large/structured data. Handles rrweb event streams, network capture data, and screenshots without exhausting memory. Persists across service worker restarts (important for Manifest V3's 30s idle timeout).

### 14. Installation follows mcp-chrome's proven pattern
**Why**: `npm install -g` + load unpacked extension + MCP config is the established flow users of similar tools expect. Initially considered a simpler `npx` auto-download approach, but mcp-chrome's method is more robust (explicit global install, supports both Streamable HTTP and stdio transport, manual registration fallback for pnpm).
