<h1 align="center">UnderPixel</h1>

<p align="center">
  <strong>Record, replay, and understand what's behind the pixels.</strong>
</p>

<p align="center">
  <em>Timestamped visual–API correlation for Claude Code and any MCP client.</em>
</p>

<p align="center">
  <a href="https://opensource.org/licenses/MIT"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-yellow.svg"></a>
  <img alt="Chrome Extension" src="https://img.shields.io/badge/Chrome-Extension-brightgreen.svg?logo=googlechrome&logoColor=white">
  <img alt="MCP" src="https://img.shields.io/badge/Model_Context_Protocol-1.x-blueviolet.svg">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.8+-3178C6.svg?logo=typescript&logoColor=white">
  <img alt="Svelte 5" src="https://img.shields.io/badge/Svelte-5-FF3E00.svg?logo=svelte&logoColor=white">
  <a href="https://github.com/Leluth/underpixel"><img alt="GitHub stars" src="https://img.shields.io/github/stars/Leluth/underpixel?style=social"></a>
</p>

<p align="center">
  <a href="#-what-is-underpixel">What is it</a> •
  <a href="#-key-features">Features</a> •
  <a href="#-quick-start">Quick Start</a> •
  <a href="#-mcp-tools">Tools</a> •
  <a href="#-architecture">Architecture</a> •
  <a href="#-roadmap">Roadmap</a>
</p>

---

> **Status:** Phases 1–3 complete (core capture, replay UI, dependency graph & session export). Phase 4 (auto-docs, performance overlays, dependency-graph UI) in progress. Active development.

## 🎯 What is UnderPixel?

**UnderPixel** is a Chrome extension + MCP server that gives AI coding assistants — Claude Code, Cursor, Claude Desktop, VS Code Copilot, Windsurf, or anything that speaks MCP — the one piece of context every other browser tool is missing: **which API calls feed which UI elements**.

Existing browser MCPs treat network capture and visual capture as separate, unlinked streams. UnderPixel bundles them by timestamp:

```
Snapshot Bundle @ T = 1712345678000
├── screenshot        PNG
├── dom_state         rrweb incremental snapshot
├── api_calls         [ { url, method, status, headers, body, timing }, … ]
├── trigger           "fetch response: GET /api/okrs"
└── correlation       "DOM #okr-table updated from GET /api/okrs"
```

Ask Claude _"what API feeds the user table?"_ and get an answer grounded in actual recorded traffic — not guesswork from page source.

## ✨ Key Features

- 🔗 **Visual–API correlation** — every screenshot, DOM mutation, and API call indexed on a shared timeline. The core differentiator.
- 🧠 **API dependency graph** — auto-detects call chains via value propagation (JWT → request, ID → URL, token → header). Maps your auth flow without you writing a line.
- 🎬 **Session replay with synced timeline** — rrweb-player on the left, event-grouped API timeline on the right. Click a request, jump to the moment it fired.
- 📡 **Full network capture via CDP** — request and response _bodies_, headers, timing. Not just URLs. Powered by `chrome.debugger`.
- 📸 **Smart screenshot gate** — 2-layer system (rrweb event stream + stability wait → pixelmatch diff). Captures only frames where pixels actually changed.
- 🌐 **Works in your real browser** — your cookies, your logins, your extensions. No `--remote-debugging-port`, no separate profile, no Playwright relaunch.
- 🤖 **AI action audit trail** — when Claude Code drives the browser via MCP, UnderPixel silently records everything. Replay exactly what the agent did.
- 📦 **Session export & share** — `.underpixel` files (gzipped JSON). Hand a teammate a full reproduction of a bug — DOM, network, screenshots, all of it.
- 🔌 **Client agnostic** — Streamable HTTP or stdio MCP transport. Works with any compliant client.
- 🎯 **~12 focused tools, not 27** — opinionated surface, less token overhead in tool definitions, more context for actual work.

## 🆚 How UnderPixel Compares

| Capability                              | mcp-chrome | chrome-devtools-mcp | browser-tools-mcp | **UnderPixel**     |
| --------------------------------------- | ---------- | ------------------- | ----------------- | ------------------ |
| Network capture w/ response bodies      | ✅         | ✅                  | ⚠️ partial        | ✅                 |
| Screenshots                             | ✅         | ✅                  | ✅                | ✅                 |
| Works in your real browser              | ✅         | ❌ needs flags      | ✅                | ✅                 |
| **Network ↔ DOM correlation**           | ❌         | ❌                  | ❌                | ✅                 |
| **DOM mutation recording**              | ❌         | ❌                  | ❌                | ✅ (rrweb)         |
| **Pixel-level visual change detection** | ❌         | ❌                  | ❌                | ✅ (pixelmatch)    |
| **Synced session replay**               | ❌         | ❌                  | ❌                | ✅ (rrweb-player)  |
| **API dependency graph**                | ❌         | ❌                  | ❌                | ✅                 |
| **AI action audit / replay**            | ❌         | ❌                  | ❌                | ✅                 |
| Session export & share                  | ❌         | ❌                  | ❌                | ✅ (`.underpixel`) |
| Tool count                              | 27         | ~25                 | ~15               | ~12 (focused)      |

> 📝 UnderPixel builds on the proven infrastructure patterns of [mcp-chrome](https://github.com/hangwin/mcp-chrome) (Native Messaging bridge, CDP capture, Streamable HTTP) and uses [rrweb](https://github.com/rrweb-io/rrweb) directly as a dependency for DOM recording and replay. The novel contribution is the **correlation layer** — the thing that turns raw streams into context an LLM can reason about.

## 🚀 Quick Start

### Prerequisites

- **Node.js** ≥ 20
- **Chrome** (or any Chromium browser — Edge, Brave, Arc work)
- An **MCP-compatible client**: Claude Code, Claude Desktop, Cursor, VS Code Copilot, Windsurf…

### 1. Install the bridge

```bash
# npm
npm install -g underpixel-bridge

# pnpm (postinstall scripts must be enabled)
pnpm config set enable-pre-post-scripts true
pnpm install -g underpixel-bridge

# fallback: register manually if postinstall didn't run
underpixel-bridge register
```

The bridge auto-registers itself as a Chrome Native Messaging host. It is a thin stdio-↔-Native-Messaging translator (~200 lines) — all logic lives in the extension, so the bridge package rarely needs updating.

### 2. Load the Chrome extension

1. Download the latest extension build from [GitHub Releases](https://github.com/Leluth/underpixel/releases).
2. Open `chrome://extensions/` and enable **Developer mode**.
3. Click **Load unpacked** and select the unzipped folder.
4. Click the UnderPixel toolbar icon → **Connect** to view your local MCP endpoint.

> Once stable, UnderPixel will be published to the Chrome Web Store for one-click install.

### 3. Wire it up to your MCP client

**Streamable HTTP** (recommended — supports per-session transports, no subprocess spawn):

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

**stdio** (for clients that don't speak HTTP yet):

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

The exact port number is shown in the extension popup after **Connect**.

### 4. Try it

In Claude Code (or any MCP client), ask:

> _"Open the Hacker News front page, capture network for 5 seconds, then tell me which API delivered the story list and what its response shape looks like."_

UnderPixel will navigate, record, correlate, and hand back a structured answer with the actual endpoint URL, request method, response schema, and a timestamped DOM snapshot showing the result rendered on screen.

## 🛠️ MCP Tools

UnderPixel exposes ~12 tools organized by purpose. The full schemas are in [`packages/shared/src/tool-schemas.ts`](packages/shared/src/tool-schemas.ts).

<details open>
<summary><strong>🔗 Correlation (the differentiator)</strong></summary>

| Tool                                                | Description                                                                                                                                                                                                                               |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `underpixel_correlate(query)`                       | _"What API feeds the user table?"_ Forward (URL/body text search), reverse (DOM element → APIs via rrweb snapshots), and value-level (DOM text → specific JSON response field). Supports CSS selectors, attribute queries, and free text. |
| `underpixel_timeline(startTime?, endTime?, limit?)` | Chronological correlation bundles — API + DOM + visual state, joined on timestamp.                                                                                                                                                        |
| `underpixel_snapshot_at(timestamp)`                 | Closest screenshot + active API calls at a specific moment.                                                                                                                                                                               |

</details>

<details>
<summary><strong>📡 Network</strong></summary>

| Tool                                | Description                                                                      |
| ----------------------------------- | -------------------------------------------------------------------------------- |
| `underpixel_capture_start(filter?)` | Start recording network + DOM + visual state. Configurable URL/domain filter.    |
| `underpixel_capture_stop()`         | Stop capture, return correlated summary.                                         |
| `underpixel_api_calls(filter?)`     | Query captured API calls with full headers, request and response bodies, timing. |
| `underpixel_api_dependencies()`     | Auto-detected call chain — typed edges (`bearer_token`, `id`, `session`, …).     |

</details>

<details>
<summary><strong>📸 Visual & Replay</strong></summary>

| Tool                               | Description                                                               |
| ---------------------------------- | ------------------------------------------------------------------------- |
| `underpixel_screenshot(selector?)` | On-demand screenshot — viewport, full page, or single element.            |
| `underpixel_dom_text(selector)`    | Current text content of elements (TreeWalker-based, safe for any markup). |
| `underpixel_replay(timeRange)`     | Open the replay tab in the browser; returns the session bundle.           |

</details>

<details>
<summary><strong>🎯 Browser Control (minimal)</strong></summary>

| Tool                            | Description                                                          |
| ------------------------------- | -------------------------------------------------------------------- |
| `underpixel_navigate(url)`      | Open a URL (new tab or update existing).                             |
| `underpixel_interact(action)`   | Click, fill, scroll, type, press key.                                |
| `underpixel_page_read(filter?)` | Accessibility tree of visible elements (`'all'` or `'interactive'`). |

</details>

## 🧩 Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Chrome Extension (Manifest V3 · WXT · Svelte 5)             │
│                                                              │
│  Content (MAIN)                                              │
│    └─ rrweb.record()           → DOM event stream            │
│    └─ PerformanceObserver      → layout-shift signals        │
│                                                              │
│  Background (Service Worker)                                 │
│    ├─ chrome.debugger          → CDP network capture         │
│    ├─ Correlation Engine       → timestamp-window matching   │
│    ├─ Screenshot Gate          → rrweb + stability + diff    │
│    ├─ IndexedDB                → sessions · events · bodies  │
│    └─ Native Messaging         → stdio to bridge             │
│                                                              │
│  Offscreen Document                                          │
│    └─ pixelmatch               → canvas-based pixel diff     │
│                                                              │
│  Replay Page (chrome-extension://…/replay.html)              │
│    ├─ rrweb-player             → interactive replay          │
│    └─ Event-grouped API timeline (synced via Svelte store)   │
└─────────────────────────┬────────────────────────────────────┘
                          │  Native Messaging
┌─────────────────────────┴────────────────────────────────────┐
│  underpixel-bridge (npm package · Fastify · ~200 LOC)        │
│    └─ stdio ↔ Native Messaging · MCP transport routing       │
└─────────────────────────┬────────────────────────────────────┘
                          │  MCP JSON-RPC (Streamable HTTP or stdio)
┌─────────────────────────┴────────────────────────────────────┐
│  Claude Code · Cursor · Claude Desktop · any MCP client      │
└──────────────────────────────────────────────────────────────┘
```

**Why this shape:**

- **All logic in the extension.** The bridge is a dumb pipe. The extension auto-updates via the Web Store; the npm package rarely changes. Single source of truth, no syncing issues.
- **Per-session MCP transports.** Each MCP client gets its own `StreamableHTTPServerTransport` + `McpServer` instance — matches the official SDK pattern and supports concurrent clients.
- **IndexedDB everywhere.** Long sessions with hundreds of API calls + rrweb events would exhaust memory. IndexedDB persists across MV3 service-worker restarts (30s idle timeout) and indexes by timestamp + URL for fast queries.
- **CDP, not webRequest.** `chrome.webRequest` cannot read response bodies. Since "what data did this API return" is the heart of correlation, `chrome.debugger` is required.

## 📖 How the correlation works

The trick isn't capturing things — it's _joining_ them.

1. **Three independent streams** flow into a single per-tab buffer:
   - rrweb DOM events (mutation, layout-shift, input, etc.)
   - CDP network events (`Network.requestWillBeSent` / `responseReceived` / `getResponseBody`)
   - Smart screenshots (gated by rrweb activity + stability + pixelmatch diff threshold)
2. **The correlation engine** groups them within a configurable window (default 500 ms): an API response at _T_, DOM mutations at _T + 20 ms_, and a screenshot at _T + 100 ms_ become a single `CorrelationBundle`.
3. **The dependency engine** extracts trackable values from each response (JWTs, UUIDs, hex tokens, high-entropy strings, numeric IDs) and searches for them in subsequent request URLs, auth headers, and bodies — emitting a typed edge list.
4. **MCP tools** query that bundle store. `correlate(query)` does forward, reverse, and value-level matching. The LLM does deeper reasoning on top of pre-joined data — instead of paginating through raw HAR files.

## 📦 Repository Layout

```
underpixel/
├── extension/                  Chrome extension (WXT, Manifest V3)
│   ├── entrypoints/            background · content · popup · replay · offscreen
│   └── lib/
│       ├── network/            CDP capture, ref-counted debugger session
│       ├── correlation/        timestamp matching, rrweb DOM walker
│       ├── screenshot/         2-layer gate + pipeline
│       ├── recording/          batched rrweb event persistence
│       ├── storage/            IndexedDB schema (idb)
│       └── tools/              MCP tool handlers
├── bridge/                     npm: underpixel-bridge (Fastify + Native Messaging)
├── packages/shared/            shared types, MCP tool schemas, constants
└── docs/                       high-level vision, tech design, feature specs
```

## 🛠️ Development

```bash
pnpm install        # from monorepo root
pnpm build          # build shared → bridge → extension
pnpm dev            # WXT dev mode with HMR (extension only)
pnpm test           # vitest across all packages
pnpm lint           # ESLint
pnpm format:check   # Prettier
```

See [`CLAUDE.md`](CLAUDE.md) for non-obvious project conventions (e.g. rrweb runs in the MAIN world content script and is bridged via `window.postMessage`; response bodies > 100 KB are stored in a separate IndexedDB store).

## 🗺️ Roadmap

- [x] **Phase 1** — Core MVP: network capture, rrweb integration, correlation engine, 8 MCP tools, basic popup
- [x] **Phase 2** — 2-layer screenshot gate, offscreen pixelmatch, replay page (rrweb-player + event-based API timeline), `timeline` / `snapshot_at` / `replay` / `dom_text` tools
- [x] **Phase 3** — Value-propagation dependency graph, `.underpixel` session export/import (gzipped, with header-masking and body-stripping options)
- [ ] **Phase 4** — Auto-generated API docs, performance annotations on replay, visual dependency-graph UI (elkjs), advanced filters
- [ ] **Phase 5** — Edge / Brave / Arc support (Chromium-trivial), Firefox port (`browser.devtools.network`), browser-API abstraction layer
- [ ] **Future** — Chrome Web Store listing, push-based "Explain this page" once MCP supports server→client push

## 🙏 Acknowledgments

UnderPixel stands on the shoulders of two excellent MIT-licensed projects:

- **[mcp-chrome](https://github.com/hangwin/mcp-chrome)** by [@hangwin](https://github.com/hangwin) — reference implementation for the Native Messaging bridge, CDP network capture pipeline, screenshot stitching, and Streamable HTTP MCP server. UnderPixel re-implements these patterns rather than depending on the package directly (mcp-chrome is an extension, not a library), but the architectural debt is significant and gratefully acknowledged.
- **[rrweb](https://github.com/rrweb-io/rrweb)** — DOM recording and replay. Used directly as an npm dependency. rrweb's smart mutation batching is also what made the screenshot gate simple enough to ship — see [Design decision #5](docs/UNDERPIXEL_HIGHLEVEL.md#design-decisions-log) for details.

Also leaning on **[pixelmatch](https://github.com/mapbox/pixelmatch)** (ISC), **[@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk)** (MIT), and the **[WXT](https://wxt.dev/)** extension framework.

## 📄 License

[MIT](LICENSE) — same as our upstreams.

---

<p align="center">
  <em>Made with rrweb, mcp, and a lot of pixel-counting.</em>
</p>
