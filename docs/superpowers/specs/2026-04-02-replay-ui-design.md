# Replay UI Design Spec

**Date**: 2026-04-02
**Phase**: 2 (partial — Replay UI only, smart screenshot gate deferred)
**Status**: Approved

## Overview

Build a session replay interface as a Chrome extension tab page (`replay.html`). The replay UI provides:

- rrweb-based DOM replay (left pane)
- API call timeline grouped by correlation bundles (right pane)
- Full bidirectional sync between replay and timeline
- Slide-out detail panel for request/response inspection
- Full-text search and filtering across API calls
- Session picker dropdown for navigating between recordings

Launchable from both the extension popup ("View Replay" button) and the existing `underpixel_replay` MCP tool.

## Technology

- **Svelte** — native rrweb-player integration (rrweb-player is a Svelte component), reactive stores for bidirectional sync
- **rrweb-player** — Svelte component, no wrapper needed
- **WXT** — already used for the extension build; supports Svelte via framework integration
- The popup remains vanilla TS (simple enough to not need a framework)

## Visual Design

### Theme: "Cozy Pixel RPG"

Professional dark developer tool with pixel-art personality in branding, headers, and status indicators.

#### Color Palette

| Token            | Hex       | Usage                                          |
| ---------------- | --------- | ---------------------------------------------- |
| `deep-bg`        | `#0f0c24` | Viewport background, input backgrounds         |
| `base-bg`        | `#171330` | Main panel backgrounds                         |
| `surface`        | `#221d45` | Cards, top bar, footer                         |
| `surface-active` | `#2a2350` | Highlighted/active cards                       |
| `border`         | `#352e6b` | All borders (3px, pixel-art thick)             |
| `text-primary`   | `#f0ecff` | URLs, main content (high contrast)             |
| `text-secondary` | `#e0d8ff` | Secondary info, labels                         |
| `text-muted`     | `#c0b8e8` | Timing values, inactive items                  |
| `text-dim`       | `#9088c0` | Group headers, placeholders                    |
| `accent`         | `#ff8a80` | Brand color (coral/peach), active states, logo |
| `accent-light`   | `#ffab91` | Gradient end for progress bars                 |
| `success`        | `#a5d6a7` | 2xx status, GET method badges                  |
| `warning`        | `#ffcc80` | Active correlation highlight, slow calls       |
| `error`          | `#ef9a9a` | 4xx/5xx status, error messages                 |

#### Typography

| Font             | Usage                                                |
| ---------------- | ---------------------------------------------------- |
| `Press Start 2P` | Logo, correlation group headers, tiny labels (7-9px) |
| `Silkscreen`     | HTTP methods, buttons, nav items, search (10-11px)   |
| `VT323`          | URLs, timing, body text, detail panel (14-16px)      |

#### UI Elements

- **3px borders** throughout (pixel-art thick feel)
- **Pixel-art box-shadow** on outer containers: `inset -4px -4px 0px rgba(0,0,0,0.3), inset 4px 4px 0px rgba(255,255,255,0.08)`
- **Subtle scanline overlay** on main container (repeating-linear-gradient, very faint)
- **RPG-style symbols** in group headers: stars, hearts, diamonds
- **"NOW" badge** on active correlation group: `Press Start 2P` 7px, coral background

## Layout

Three-panel layout in a single extension tab page:

```
+------------------------------------------------------------------+
| UNDERPIXEL  [Session dropdown ▼]               [Export .underpixel]|
+-------------------------------+----------------------------------+
|                               | Search [____________]            |
|                               | [2xx] [3xx] [4xx/5xx] [GET] ... |
|   rrweb-player viewport       +----------------------------------+
|   (replayed page content)     | ★ PAGE LOAD                     |
|                               |   GET /api/okrs         200 245ms|
|                               |   GET /api/user         200  89ms|
|   [correlation badge]         | ♥ METRICS UPDATE          [NOW] |
|                               |   GET /api/metrics      200 1.2s |
+-------------------------------+   ♦ DOM: #metrics-grid           |
| ◀◀  ▶  ▶▶  00:47/02:34       | ★ USER ACTION                   |
| [====*========] markers  [1x] |   POST /api/feedback    201 156ms|
+-------------------------------+   GET /api/teams        500 3.1s |
                                +----------------------------------+
                                | 5 calls  3 correlations  1 error |
                                +----------------------------------+
```

### Top Bar

- Left: `UNDERPIXEL` logo in `Press Start 2P`, coral (#ff8a80)
- Center: Session picker dropdown (Silkscreen font, shows session name + duration)
- Right: "Export" button (styled as pixel button with coral border)

### Left Pane: rrweb Player

- rrweb-player Svelte component fills the pane
- Replayed page content rendered inside, scaled to fit
- Correlation badge overlay (bottom-right): shows `♦ GET /api/endpoint` when a call is active
- DOM element highlight: CSS outline injected into replay when a correlated element is identified

### Player Controls Bar

- Play/pause/skip buttons in Silkscreen font, coral colored
- Timestamp display in VT323: `00:47 / 02:34`
- Custom scrubber progress bar:
  - Gradient fill (coral → light coral) showing current position
  - Colored tick markers at positions where API calls occurred
  - Green ticks for 2xx, orange for active correlation, red for errors
- Speed selector dropdown: 1x, 2x, 4x

### Right Pane: API Timeline

- **Search bar** at top: full-text search across URLs, headers, response bodies
- **Filter chips** below search: toggle by status range (2xx, 3xx, 4xx/5xx) and HTTP method (GET, POST, etc.)
- **Correlation groups**: API calls grouped by their correlation bundle
  - Group header: `Press Start 2P` 7px, RPG symbol + auto-generated name
  - Group naming logic: derive from the trigger field of the CorrelationBundle (e.g., trigger "navigation" → "PAGE LOAD", trigger "fetch response" → name from the primary API call's path like "METRICS UPDATE" from `/api/metrics`). Falls back to timestamp-based name ("EVENT @ 00:47") if no clear trigger.
  - **Uncorrelated calls**: API calls with no correlation bundle are placed in a catch-all "★ OTHER CALLS" group at the bottom, sorted by timestamp. They still appear in the timeline and are clickable — they just don't have DOM correlation info.
  - Active group gets "NOW" badge in coral
- **API call entries**: cards with left border colored by status
  - Method badge (Silkscreen) + URL path (VT323 15px, `text-primary`)
  - Status code on the right
  - Duration bar (4px tall, colored by status) + timing value (VT323 13px, `text-muted`)
  - Correlation note when applicable (e.g., "♦ DOM: Updated #metrics-grid")
- **Summary bar** at bottom: total calls, correlation count, error count

### Slide-Out Detail Panel

Opens when clicking an API call entry. Overlays from the right (480px wide), doesn't push layout. Background dims.

**Header**: Method + URL + status badge, close button (`✕ ESC`)

**5 tabs** (Silkscreen font, coral underline on active):

| Tab         | Content                                                                                                                                                           |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Headers     | General info table (URL, method, status, duration, timestamp) + request headers + response headers. Header keys color-coded: request in coral, response in green. |
| Request     | Request body with syntax-highlighted JSON, collapse/expand for nested objects. Raw text fallback for non-JSON.                                                    |
| Response    | Response body with syntax-highlighted JSON, collapse/expand. Truncated bodies show "Load full body" button (queries IndexedDB `responseBodies` store).            |
| Timing      | Timing breakdown: DNS, connect, TLS, TTFB, transfer. Visual waterfall bar.                                                                                        |
| Correlation | Which DOM elements this API call fed. Shows selector, matched text/values, timestamp offset. Links back to replay position.                                       |

**Footer**: "Copy cURL" and "Copy JSON" action buttons.

**Dismiss**: ESC key, click outside panel, or close button.

## Bidirectional Sync

Central state managed by a Svelte writable store (`ReplayStore`):

```typescript
interface ReplayStore {
  currentTime: number; // ms offset from session start
  activeSession: Session;
  selectedCall: NetworkRequest | null; // clicked API call
  hoveredCall: NetworkRequest | null;
  activeCorrelation: CorrelationBundle | null;
  filters: FilterState;
  isPlaying: boolean;
}
```

### Direction 1: Replay → Timeline

1. rrweb-player's `onTimeChange(time)` writes `currentTime` to store
2. Timeline reactively finds which correlation group contains `currentTime`
3. Active group gets "NOW" badge + highlighted background (`surface-active`)
4. Timeline auto-scrolls to keep active group visible
5. API calls whose `startTime ≤ currentTime ≤ endTime` get extra highlight

### Direction 2: Timeline → Replay

1. Click an API call → set `selectedCall` in store
2. rrweb-player seeks to `call.startTime` (relative to session start)
3. Player pauses at that moment
4. Correlation badge on replay viewport updates
5. If call has a correlation bundle, correlated DOM element gets CSS outline in replay

### Direction 3: Replay → Detail (click-in-replay)

1. Click on element in rrweb replay viewport
2. Post click target's selector/attributes to store
3. Store looks up correlation bundles matching that selector near `currentTime`
4. If found: `activeCorrelation` set, matching API calls highlighted in timeline
5. Double-click: opens detail panel for the primary correlated API call

### Edge Cases

- **Multiple calls at same timestamp**: Group them visually, highlight all
- **No correlation found**: Subtle "No correlation data" indicator, don't break flow
- **Filter hides active call**: Active call stays visible (dimmed but present) so context isn't lost
- **Seeking during playback**: Pause, seek, let user resume manually

## Data Flow

### IndexedDB → Replay UI (direct read, no MCP/bridge involved)

1. Replay page reads `session` ID from URL params
2. Queries IndexedDB stores: `sessions`, `networkRequests`, `rrwebEvents`, `correlationBundles`, `screenshots`
3. Feeds rrweb events into rrweb-player
4. Builds timeline from `networkRequests` grouped by `correlationBundles`
5. Filter changes re-query IndexedDB reactively

### MCP Tool: `underpixel_replay`

Updated behavior for Phase 2:

1. Opens replay tab: `chrome.tabs.create({ url: chrome.runtime.getURL('replay.html?session=<id>') })`
2. Returns confirmation to Claude: `"Replay opened in browser for session <id>"`
3. Optional `timestamp` param to open at a specific moment (`?session=<id>&t=<ms>`)

### Popup Integration

- "View Replay" button added per session in the popup
- Calls `chrome.tabs.create()` with the replay URL
- Session list in popup shows: start URL hostname, duration, API call count, date

## Component Structure

```
extension/src/replay/
  App.svelte                 — root layout (top bar, 3-panel structure)
  stores/
    replay-store.ts          — central Svelte writable store (ReplayStore)
    session-store.ts         — session list + picker state
  components/
    Player.svelte            — wraps rrweb-player, binds onTimeChange to store
    Timeline.svelte          — API call list grouped by correlations
    TimelineEntry.svelte     — single API call row with duration bar
    CorrelationGroup.svelte  — group header (★/♥/♦) + child entries
    DetailPanel.svelte       — slide-out panel container with tab routing
    DetailTabs/
      HeadersTab.svelte      — general info + request/response headers
      RequestTab.svelte      — request body with syntax highlighting
      ResponseTab.svelte     — response body with syntax highlighting + lazy load
      TimingTab.svelte       — timing breakdown waterfall
      CorrelationTab.svelte  — correlated DOM elements list
    SearchBar.svelte         — full-text search input + method/status filter chips
    Scrubber.svelte          — custom progress bar with API call markers
    SessionPicker.svelte     — dropdown for switching sessions
  lib/
    db.ts                    — IndexedDB queries (reuses shared/existing DB module)
    sync.ts                  — bidirectional sync logic (store subscriptions)
    search.ts                — full-text search across URLs, headers, bodies
    theme.ts                 — color palette constants + CSS custom properties
```

## Build Integration

- WXT config updated to register `replay.html` as an extension page entrypoint
- Svelte support added via WXT's built-in module system (`wxt.config.ts` → `modules: ['@anthropic/wxt-svelte']` or equivalent Svelte plugin for Vite). Exact module TBD — verify WXT Svelte integration docs at build time since WXT's module ecosystem evolves. Fallback: configure `vite.plugins` with `@sveltejs/vite-plugin-svelte` directly in WXT config.
- rrweb-player added as npm dependency: `rrweb-player` (v2.0.0-alpha+ from `@rrweb/player` package in the rrweb monorepo). Verify exact import path at install time — the rrweb v2 monorepo restructured packages.
- Fonts: bundle `Press Start 2P`, `Silkscreen`, and `VT323` as local woff2 files in `extension/assets/fonts/` rather than loading from Google Fonts CDN — extension pages may not have internet access and this avoids a network dependency.

## Out of Scope (deferred)

- **Smart screenshot gate** (2-layer pixelmatch system) — separate spec
- **Session export/import** (.underpixel files) — Phase 3
- **API dependency graph visualization** (elkjs DAG) — Phase 3/4
- **Performance annotations** — Phase 4
- **API diff between sessions** — Phase 4
