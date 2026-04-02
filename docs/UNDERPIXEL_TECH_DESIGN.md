# UnderPixel Technical Design

**Companion to**: `UNDERPIXEL_HIGHLEVEL.md` (vision, features, competitive landscape, design decisions)
**Purpose**: A new session reads both documents and can implement UnderPixel without ambiguity.

---

## Table of Contents

- [1. Tech Stack Selection](#1-tech-stack-selection)
- [2. Repository Structure](#2-repository-structure)
- [3. Architecture Deep Dive](#3-architecture-deep-dive)
- [4. Data Model & Storage](#4-data-model--storage)
- [5. Component Design](#5-component-design)
- [6. Correlation Engine](#6-correlation-engine)
- [7. API Dependency Graph](#7-api-dependency-graph)
- [8. MCP Tool Specifications](#8-mcp-tool-specifications)
- [9. Security Design](#9-security-design)
- [10. Implementation Plan](#10-implementation-plan)
- [11. Edge Cases & Mitigations](#11-edge-cases--mitigations)
- [12. Testing & Verification Strategy](#12-testing--verification-strategy)

---

## 1. Tech Stack Selection

### 1.1 Languages & Runtime

| Choice                                  | Why                                                                                                                                    |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **TypeScript (strict mode)** everywhere | Type safety across extension + bridge + shared types. Same language both sides of Native Messaging. mcp-chrome uses this successfully. |
| **Node.js >= 20** for bridge            | Required by `@modelcontextprotocol/sdk`. LTS stability. Native ESM support.                                                            |

### 1.2 Extension Build System: WXT

**Choice**: [WXT](https://wxt.dev/) (Web Extension Toolkit)

**Why WXT over raw Manifest V3 or Plasmo**:

- WXT is framework-agnostic (we don't need Vue/React for our simple UI)
- First-class Manifest V3 support with auto-generated manifest from code conventions
- Built-in support for content scripts with `world: 'MAIN'` declaration
- HMR in development (critical for iteration speed on content scripts)
- Multi-browser build targets (`chrome`, `firefox`) from same source
- mcp-chrome uses WXT successfully at scale (11k+ users)
- Vite under the hood = fast builds, tree-shaking, easy plugin ecosystem

**Why not Plasmo**: Plasmo is more opinionated (forces React, has its own messaging abstraction). WXT gives us more control with less magic, which matters when we need precise control over content script injection worlds and Native Messaging setup.

**Why not raw MV3**: Too much boilerplate for manifest management, HMR, multi-browser builds. WXT eliminates ~500 lines of build configuration.

### 1.3 UI Framework: None (Vanilla TypeScript)

**Why no framework for popup/replay page**:

- **Popup**: Toggle button + settings form. ~200 lines of DOM. A framework adds 30KB+ for no benefit.
- **Replay page**: The main UI component is `rrweb-player`, which is a Svelte component but exposes a framework-agnostic constructor API (`new Player({ target, props })`). We mount it directly. The API timeline panel beside it is a scrollable list with click handlers — vanilla TS with CSS is cleaner and faster than introducing React/Vue.

**Tradeoff acknowledged**: If the replay UI grows significantly (v3+ features like dependency graph visualization, API diff viewer), we may introduce a lightweight framework (Preact at 3KB or Svelte). But for v1-v2, vanilla TS keeps the extension lean and avoids framework lock-in.

### 1.4 Bridge HTTP Server: Fastify

**Choice**: [Fastify](https://fastify.dev/)

**Why**: Same as mcp-chrome. Minimal overhead, good TypeScript support, easy CORS setup. The bridge serves exactly 3 routes (`/mcp`, `/ping`, `/sse`) — any HTTP framework works, but Fastify is proven in this exact use case.

### 1.5 MCP SDK: `@modelcontextprotocol/sdk`

**Version**: Latest stable (currently ^1.11.x)

**Transports supported**:

- **Streamable HTTP** (recommended) — extension tells bridge to start HTTP server, MCP clients connect to `http://127.0.0.1:PORT/mcp`
- **stdio** — bridge is spawned as subprocess by MCP client, bridges stdio JSON-RPC to the HTTP server internally

This dual-transport approach is identical to mcp-chrome and is proven to work with Claude Code, Claude Desktop, Cursor, and VS Code Copilot.

### 1.6 Key Dependencies

| Package                     | Version | Purpose                         | Size Impact                                                |
| --------------------------- | ------- | ------------------------------- | ---------------------------------------------------------- |
| `rrweb` (record only)       | ^2.x    | DOM recording in content script | ~45KB min+gz (record entry only)                           |
| `rrweb-player`              | ^2.x    | Replay UI component             | ~80KB min+gz (replay page only, not loaded during capture) |
| `pixelmatch`                | ^6.x    | Pixel-level image comparison    | ~2KB min+gz (zero deps)                                    |
| `@modelcontextprotocol/sdk` | ^1.11.x | MCP server protocol             | Bridge only                                                |
| `fastify`                   | ^5.x    | HTTP server for MCP             | Bridge only                                                |
| `idb`                       | ^8.x    | Promise-based IndexedDB wrapper | ~1.5KB min+gz                                              |

**What we are NOT using** (and why):

- **No `mutation-summary`**: rrweb already handles smart mutation batching. Adding a parallel MutationObserver is redundant (see HIGHLEVEL doc, Design Decision #5).
- **No `blockhash-core`**: Perceptual hashing adds a layer between "DOM changed" and "pixels changed" that isn't worth the complexity. rrweb events + pixelmatch is sufficient.
- **No Vue/React/Svelte as framework**: See 1.3 above.
- **No `elkjs` in v1**: API dependency graph is returned as JSON edge list to MCP clients. Visual DAG rendering is v3+.
- **No transformers.js / WASM-SIMD**: mcp-chrome uses these for semantic search. UnderPixel doesn't need in-browser AI — the MCP client (Claude Code) IS the AI. We just provide structured data.

### 1.7 Monorepo Tooling

| Tool                | Purpose                                                    |
| ------------------- | ---------------------------------------------------------- |
| **pnpm workspaces** | Monorepo package management (proven by mcp-chrome)         |
| **tsup**            | TypeScript bundling for bridge package (fast, zero-config) |
| **WXT/Vite**        | Extension build                                            |
| **vitest**          | Unit testing (shared config, works with both WXT and tsup) |

---

## 2. Repository Structure

```
underpixel/
├── pnpm-workspace.yaml          # workspace: ["extension", "bridge", "packages/*"]
├── package.json                 # root scripts: build, dev, test, lint
├── tsconfig.base.json           # shared TS config
│
├── extension/                   # Chrome extension (WXT project)
│   ├── wxt.config.ts            # WXT + Vite config, manifest generation
│   ├── package.json             # deps: rrweb, rrweb-player, pixelmatch, idb
│   ├── assets/                  # Icons, pixel art branding
│   │
│   ├── entrypoints/
│   │   ├── background.ts             # Service worker entry (WXT convention)
│   │   ├── content.ts                # Content script (ISOLATED world) — bridge
│   │   ├── content-recorder.ts       # Content script (MAIN world) — rrweb record
│   │   ├── popup/                    # Extension popup
│   │   │   ├── index.html
│   │   │   ├── main.ts
│   │   │   └── style.css
│   │   ├── replay.html               # Extension page (opens as chrome tab)
│   │   ├── replay/
│   │   │   ├── main.ts               # Mounts rrweb-player + API timeline
│   │   │   └── style.css
│   │   └── offscreen.html            # Offscreen document for canvas ops
│   │
│   ├── lib/                     # Extension-internal modules
│   │   ├── network/
│   │   │   ├── capture.ts            # chrome.debugger CDP network capture
│   │   │   └── cdp-session.ts        # Ref-counted debugger attach/detach
│   │   ├── correlation/
│   │   │   ├── engine.ts             # Timestamp-based correlation
│   │   │   ├── types.ts              # CorrelationBundle, CorrelationWindow
│   │   │   └── query.ts              # "What API feeds this element?"
│   │   ├── screenshot/
│   │   │   ├── gate.ts               # 2-layer screenshot decision logic
│   │   │   ├── capture.ts            # captureVisibleTab wrapper
│   │   │   └── diff.ts               # pixelmatch in offscreen document
│   │   ├── recording/
│   │   │   ├── session.ts            # Session lifecycle (start/stop/query)
│   │   │   └── events.ts             # rrweb event processing + IndexedDB write
│   │   ├── storage/
│   │   │   ├── db.ts                 # IndexedDB schema + migrations (via idb)
│   │   │   └── export.ts             # .underpixel file export/import
│   │   ├── dependency/
│   │   │   └── graph.ts              # API dependency detection (value propagation)
│   │   ├── native/
│   │   │   └── host.ts               # Native Messaging port management
│   │   ├── tools/
│   │   │   ├── registry.ts           # Tool name -> handler mapping
│   │   │   ├── core.ts               # correlate, timeline, snapshot_at
│   │   │   ├── network.ts            # capture_start/stop, api_calls, api_dependencies
│   │   │   ├── visual.ts             # screenshot, dom_text, replay
│   │   │   └── browser.ts            # navigate, interact, page_read
│   │   └── constants.ts              # Shared constants
│   │
│   └── test/                    # Extension unit tests (vitest)
│
├── bridge/                      # NPM package: underpixel-bridge
│   ├── package.json             # deps: fastify, @modelcontextprotocol/sdk
│   ├── src/
│   │   ├── index.ts             # Entry: connect native messaging + start server
│   │   ├── native-host.ts       # Length-prefixed JSON stdio protocol
│   │   ├── server.ts            # Fastify HTTP server (MCP routes)
│   │   ├── mcp.ts               # MCP server setup, tool proxy to extension
│   │   ├── stdio-bridge.ts      # stdio MCP transport (alternative to HTTP)
│   │   ├── cli.ts               # CLI: register, update-port
│   │   └── scripts/
│   │       ├── register.ts      # Write NativeMessagingHosts manifest
│   │       ├── postinstall.ts   # npm postinstall auto-registration
│   │       ├── run_host.sh      # Unix wrapper script (Node.js discovery)
│   │       └── run_host.bat     # Windows wrapper script
│   └── test/
│
├── packages/
│   └── shared/                  # Shared types between extension + bridge
│       ├── package.json
│       └── src/
│           ├── types.ts         # NativeMessage, NativeMessageType
│           ├── tool-schemas.ts  # MCP tool definitions (JSON Schema)
│           └── constants.ts     # Host name, default port, protocol version
│
├── docs/
│   ├── UNDERPIXEL_HIGHLEVEL.md  # -> symlink or copy from root
│   └── UNDERPIXEL_TECH_DESIGN.md
│
├── README.md
└── LICENSE                      # MIT
```

**Key conventions**:

- WXT uses `entrypoints/` directory convention to auto-detect background, content scripts, popup, and pages
- Content scripts declare their `world` in the file via WXT's `export default defineContentScript({ world: 'MAIN' })` pattern
- `lib/` contains all business logic, separated from WXT entry points for testability

---

## 3. Architecture Deep Dive

### 3.1 Component Communication Map

```
┌─────────────────────────────────────────────────────────────────────┐
│ Chrome Browser                                                      │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────┐        │
│  │ Tab (any website)                                       │        │
│  │                                                         │        │
│  │  content-recorder.ts [MAIN world]                       │        │
│  │  ├─ rrweb.record({ emit })                              │        │
│  │  ├─ PerformanceObserver('layout-shift')                 │        │
│  │  └─ window.postMessage(events) ──┐                      │        │
│  │                                  │                      │        │
│  │  content.ts [ISOLATED world]     │                      │        │
│  │  ├─ window.addEventListener ◄────┘                      │        │
│  │  └─ chrome.runtime.sendMessage(events) ─────────┐       │        │
│  └─────────────────────────────────────────────────┼───────┘        │
│                                                    │                │
│  ┌─────────────────────────────────────────────────┼───────┐        │
│  │ Background Service Worker                       │       │        │
│  │                                                 ▼       │        │
│  │  ┌──────────────┐  ┌───────────────┐  ┌──────────────┐ │        │
│  │  │ Network      │  │ Recording     │  │ Correlation  │ │        │
│  │  │ Capture      │  │ Manager       │  │ Engine       │ │        │
│  │  │ (CDP)        │  │ (rrweb events │  │ (timestamp   │ │        │
│  │  │              │  │  + IndexedDB) │  │  matching)   │ │        │
│  │  └──────┬───────┘  └──────┬────────┘  └──────┬───────┘ │        │
│  │         │                 │                   │         │        │
│  │         ▼                 ▼                   ▼         │        │
│  │  ┌──────────────┐  ┌────────────┐  ┌──────────────────┐│        │
│  │  │ Screenshot   │  │ IndexedDB  │  │ Tool Handlers    ││        │
│  │  │ Gate         │  │ Storage    │  │ (12 MCP tools)   ││        │
│  │  │ (2-layer)    │  │            │  │                  ││        │
│  │  └──────┬───────┘  └────────────┘  └────────┬─────────┘│        │
│  │         │                                   │          │        │
│  │         ▼                                   │          │        │
│  │  ┌──────────────┐                           │          │        │
│  │  │ Offscreen    │◄── canvas/pixelmatch      │          │        │
│  │  │ Document     │                           │          │        │
│  │  └──────────────┘                           │          │        │
│  │                                             │          │        │
│  │  chrome.runtime.connectNative ──────────────┼──────┐   │        │
│  └─────────────────────────────────────────────┼──────┼───┘        │
│                                                │      │            │
│  ┌─────────────────────────────────────────────┼──┐   │            │
│  │ Replay Page (chrome-extension://…/replay)   │  │   │            │
│  │  ├─ rrweb-player (left pane)                │  │   │            │
│  │  ├─ API Timeline (right pane, synced)       │  │   │            │
│  │  └─ reads from IndexedDB                    │  │   │            │
│  └─────────────────────────────────────────────┘  │   │            │
│                                                    │   │            │
│  ┌──────────────────────┐                          │   │            │
│  │ Popup                │                          │   │            │
│  │ toggle + settings    │                          │   │            │
│  └──────────────────────┘                          │   │            │
└────────────────────────────────────────────────────┼───┼────────────┘
                                                     │   │
                                            Native Messaging
                                             (length-prefixed
                                              JSON over stdio)
                                                     │   │
┌────────────────────────────────────────────────────┼───┼────────────┐
│ underpixel-bridge (Node.js process)                │   │            │
│                                                    │   │            │
│  ┌──────────────────┐      ┌────────────────────┐  │   │            │
│  │ Native Messaging │◄─────┤ Fastify HTTP       │  │   │            │
│  │ Host (stdio)     │─────►│ Server (/mcp)      │  │   │            │
│  └──────────────────┘      └────────┬───────────┘  │   │            │
│                                     │              │   │            │
│                            ┌────────┴───────────┐  │   │            │
│                            │ MCP Server         │  │   │            │
│                            │ (tool proxy)       │  │   │            │
│                            └────────┬───────────┘  │   │            │
└─────────────────────────────────────┼──────────────┘   │            │
                                      │                               │
                              stdio JSON-RPC                          │
                            or Streamable HTTP                        │
                                      │                               │
┌─────────────────────────────────────┼───────────────────────────────┘
│ Claude Code / Cursor / Any MCP Client
│  "underpixel_correlate('user table')"
│  "underpixel_capture_start()"
└──────────────────────────────────────
```

### 3.2 Message Flow: MCP Tool Call

```
1. Claude Code calls MCP tool "underpixel_api_calls"
2. MCP SDK (bridge) receives CallToolRequest
3. Bridge wraps as NativeMessage { type: CALL_TOOL, requestId: uuid, payload: {name, args} }
4. Bridge writes length-prefixed JSON to stdout → Native Messaging → extension
5. Background service worker receives message on chrome.runtime.Port
6. Tool registry dispatches to NetworkToolHandler.apiCalls(args)
7. Handler queries IndexedDB for matching requests
8. Handler returns result via port.postMessage({ responseToRequestId: uuid, payload: result })
9. Bridge receives response, matches by requestId
10. Bridge returns MCP CallToolResult to Claude Code
```

### 3.3 Content Script Dual-World Pattern

rrweb must run in the **MAIN** world (it needs direct access to `window`, `document`, `MutationObserver` on the real DOM). But Chrome extension APIs (`chrome.runtime.sendMessage`) only work in the **ISOLATED** world. Solution: two content scripts that communicate via `window.postMessage`.

```
┌──────────────────────────────────────────────┐
│ Web Page                                      │
│                                               │
│  content-recorder.ts [MAIN world]             │
│  ├─ Has access to real DOM                    │
│  ├─ Runs rrweb.record()                       │
│  ├─ Runs PerformanceObserver                  │
│  ├─ CANNOT use chrome.runtime.*               │
│  └─ Posts events via window.postMessage()     │
│         │                                     │
│         │ window.postMessage({ source: 'underpixel', ... })
│         ▼                                     │
│  content.ts [ISOLATED world]                  │
│  ├─ window.addEventListener('message')        │
│  ├─ Filters by source === 'underpixel'        │
│  ├─ CAN use chrome.runtime.sendMessage()      │
│  └─ Forwards to background service worker     │
│                                               │
└──────────────────────────────────────────────┘
```

**WXT content script declarations**:

```typescript
// content-recorder.ts
export default defineContentScript({
  matches: ['<all_urls>'],
  world: 'MAIN',
  runAt: 'document_idle',
  main() {
    // rrweb.record() + PerformanceObserver
    // window.postMessage to bridge
  },
});

// content.ts
export default defineContentScript({
  matches: ['<all_urls>'],
  world: 'ISOLATED', // default
  runAt: 'document_idle',
  main() {
    // window.addEventListener('message')
    // chrome.runtime.sendMessage() to background
  },
});
```

**Why not inject via `<script>` tag like rrweb's own web-extension example**: WXT's `world: 'MAIN'` declaration uses `chrome.scripting.executeScript({ world: 'MAIN' })` under the hood, which is the proper MV3 approach. It's cleaner, doesn't require `web_accessible_resources` for the script file, and doesn't leave a `<script>` element in the page DOM.

### 3.4 Service Worker Lifecycle (MV3)

Manifest V3 service workers have aggressive idle timeouts:

- **30 seconds** of inactivity → suspended
- **5 minutes** maximum continuous activity → forced restart
- **Exception**: Active `chrome.runtime.connectNative()` port keeps the worker alive indefinitely

**Our strategy**:

- The Native Messaging port to the bridge keeps the service worker alive during active MCP sessions
- When no MCP client is connected, the service worker may suspend — this is fine, it restarts on next message
- IndexedDB state persists across restarts — no in-memory-only state for capture data
- On restart: re-read capture state from IndexedDB, re-attach debugger if capture was active (via a `captureActive` flag in `chrome.storage.local`)

---

## 4. Data Model & Storage

### 4.1 IndexedDB Schema

Database name: `underpixel`

```typescript
interface UnderPixelDB {
  // Object Stores:

  sessions: {
    key: string; // UUID
    value: CaptureSession;
    indexes: {
      'by-start': number; // startTime
      'by-url': string; // initialUrl
    };
  };

  networkRequests: {
    key: string; // requestId (from CDP)
    value: NetworkRequest;
    indexes: {
      'by-session': string; // sessionId
      'by-session-time': [string, number]; // [sessionId, timestamp] compound
      'by-url-pattern': string; // url (for filtering)
    };
  };

  rrwebEvents: {
    key: number; // auto-increment
    value: StoredRrwebEvent;
    indexes: {
      'by-session': string; // sessionId
      'by-session-time': [string, number]; // [sessionId, timestamp] compound
      'by-type': number; // EventType (for filtering)
    };
  };

  screenshots: {
    key: string; // UUID
    value: StoredScreenshot;
    indexes: {
      'by-session': string; // sessionId
      'by-session-time': [string, number]; // [sessionId, timestamp]
    };
  };

  correlationBundles: {
    key: string; // UUID
    value: CorrelationBundle;
    indexes: {
      'by-session': string; // sessionId
      'by-session-time': [string, number]; // [sessionId, timestamp]
    };
  };
}
```

### 4.2 Core Types

```typescript
// ---- Session ----

interface CaptureSession {
  id: string; // UUID
  startTime: number; // Date.now()
  endTime?: number;
  initialUrl: string;
  initialTitle: string;
  tabId: number;
  status: 'active' | 'stopped' | 'error';
  config: CaptureConfig;
  stats: {
    networkRequestCount: number;
    rrwebEventCount: number;
    screenshotCount: number;
    correlationBundleCount: number;
  };
}

interface CaptureConfig {
  // Network
  includeStatic: boolean; // default: false (XHR/fetch only)
  excludeDomains: string[]; // default: analytics blocklist
  includeDomains?: string[]; // if set, only capture these domains
  maxResponseBodySize: number; // default: 1MB

  // Screenshots
  screenshotsEnabled: boolean; // default: true
  maxScreenshotsPerSession: number; // default: 100
  screenshotInterval: number; // default: 500ms
  pixelDiffThreshold: 'auto' | number; // default: 'auto'

  // Correlation
  correlationWindow: number; // default: 500ms

  // rrweb
  rrwebSampling: {
    mousemove: number | false; // default: 100 (ms throttle)
    scroll: number; // default: 150 (ms throttle)
    input: 'last'; // default: 'last' (only final value)
  };
  maskInputs: boolean; // default: false
  maskTextSelector?: string; // CSS selector for elements to mask
}

// ---- Network ----

interface NetworkRequest {
  requestId: string; // CDP requestId
  sessionId: string;
  url: string;
  method: string;
  status: 'pending' | 'complete' | 'error';
  statusCode?: number;
  type: string; // 'XHR', 'Fetch', 'Document', etc.
  mimeType?: string;

  requestHeaders?: Record<string, string>;
  requestBody?: string;
  responseHeaders?: Record<string, string>;
  responseBody?: string; // stored separately if > 100KB (see 4.3)
  responseBodyRef?: string; // key into responseBodies store

  startTime: number; // timestamp from CDP
  endTime?: number;
  duration?: number; // endTime - startTime

  encodedDataLength?: number;
  errorText?: string;
}

// ---- rrweb Events ----

interface StoredRrwebEvent {
  sessionId: string;
  timestamp: number;
  type: number; // rrweb EventType enum value
  data: any; // rrweb event data (serialized)
}

// ---- Screenshots ----

interface StoredScreenshot {
  id: string; // UUID
  sessionId: string;
  timestamp: number;
  dataUrl: string; // base64 PNG (or JPEG for compression)
  width: number;
  height: number;
  trigger: ScreenshotTrigger;
  diffPercent?: number; // pixelmatch result vs previous
}

type ScreenshotTrigger =
  | 'manual' // MCP tool call
  | 'dom-mutation' // Layer 1 passed
  | 'navigation' // URL change
  | 'api-response'; // Correlated with API

// ---- Correlation ----

interface CorrelationBundle {
  id: string; // UUID
  sessionId: string;
  timestamp: number; // anchor timestamp (API response time)
  trigger: string; // e.g., "fetch response: GET /api/okrs"
  apiCalls: string[]; // requestId references
  rrwebEventIds: number[]; // StoredRrwebEvent auto-increment keys
  screenshotId?: string; // StoredScreenshot reference
  domMutationSummary?: {
    addedNodes: number;
    removedNodes: number;
    textChanges: number;
    attributeChanges: number;
  };
  correlation: string; // Human-readable: "GET /api/users -> #user-table updated"
}
```

### 4.3 Large Response Body Strategy

Response bodies over 100KB are stored in a separate IndexedDB object store (`responseBodies`) to keep the main `networkRequests` store scannable. The `NetworkRequest` object holds a `responseBodyRef` key instead of the full body. When an MCP tool requests full body details, it does a secondary lookup.

```typescript
// Object Store
responseBodies: {
  key: string; // same as requestId
  value: {
    requestId: string;
    sessionId: string;
    body: string; // full response body
    base64Encoded: boolean;
  }
}
```

Cap: 1MB per response body (same as mcp-chrome). Bodies exceeding this are truncated with a `[truncated at 1MB]` marker.

### 4.4 Session Export Format (.underpixel)

```typescript
interface UnderPixelExport {
  version: 1;
  exportedAt: number;
  session: CaptureSession;
  rrwebEvents: StoredRrwebEvent[]; // full event stream
  networkRequests: NetworkRequest[]; // with inline response bodies
  screenshots: StoredScreenshot[]; // base64 included
  correlationBundles: CorrelationBundle[];
  dependencyEdges?: DependencyEdge[]; // if computed
}

// File format: JSON → gzip → .underpixel extension
// rrweb events compress ~10:1 with gzip
```

---

## 5. Component Design

### 5.1 Background Service Worker (`background.ts`)

The orchestrator. Responsibilities:

- Initialize and manage Native Messaging port to bridge
- Manage chrome.debugger sessions for network capture
- Receive rrweb events from content script, write to IndexedDB
- Run correlation engine on incoming events
- Trigger screenshot gate logic
- Dispatch MCP tool calls to appropriate handlers
- Manage capture session lifecycle

**Initialization sequence**:

```
1. Register chrome.debugger.onEvent listener (always, for CDP events)
2. Register chrome.runtime.onMessage listener (for content script messages)
3. Wait for Native Messaging connection from bridge
4. On CALL_TOOL message → dispatch to tool handler → return result
```

**State management**: All mutable state stored in IndexedDB + `chrome.storage.local` (for flags like `captureActive`). No critical state in JS variables alone — service worker may restart.

### 5.2 Content Script — MAIN World (`content-recorder.ts`)

Runs in page context. Minimal responsibilities:

- Start/stop rrweb recording on command
- Run `PerformanceObserver('layout-shift')` for visual change signals
- Post events to ISOLATED world content script via `window.postMessage`

```typescript
// content-recorder.ts (MAIN world)
import { record } from '@rrweb/record';

let stopFn: (() => void) | null = null;

// Listen for commands from ISOLATED world
window.addEventListener('message', (e) => {
  if (e.source !== window || e.data?.source !== 'underpixel-control') return;

  if (e.data.action === 'start-recording') {
    const config = e.data.config;
    stopFn =
      record({
        emit(event, isCheckout) {
          window.postMessage(
            {
              source: 'underpixel-event',
              type: 'rrweb',
              event,
              isCheckout,
            },
            '*',
          );
        },
        sampling: config.sampling,
        maskAllInputs: config.maskInputs,
        maskTextSelector: config.maskTextSelector,
        blockSelector: '.underpixel-block',
        slimDOMOptions: 'all', // Remove comments, <head> cruft
        recordAfter: 'DOMContentLoaded',
      }) || null;
  }

  if (e.data.action === 'stop-recording') {
    stopFn?.();
    stopFn = null;
  }
});

// PerformanceObserver for layout shifts
const layoutShiftObserver = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    window.postMessage(
      {
        source: 'underpixel-event',
        type: 'layout-shift',
        value: (entry as any).value,
        timestamp: performance.timeOrigin + entry.startTime,
      },
      '*',
    );
  }
});
layoutShiftObserver.observe({ type: 'layout-shift', buffered: false });
```

**rrweb `slimDOMOptions: 'all'`**: Strips comments, `<head>` metadata tags, favicon links — reduces event size without losing visual fidelity. Important for keeping IndexedDB lean.

### 5.3 Content Script — ISOLATED World (`content.ts`)

Bridge between page context and extension background:

```typescript
// content.ts (ISOLATED world)
window.addEventListener('message', (e) => {
  if (e.source !== window) return;
  if (e.data?.source !== 'underpixel-event') return;

  // Forward to background
  chrome.runtime.sendMessage({
    type: e.data.type, // 'rrweb' | 'layout-shift'
    payload: e.data,
  });
});

// Listen for commands from background (start/stop recording)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'underpixel-command') {
    window.postMessage(
      {
        source: 'underpixel-control',
        action: msg.action, // 'start-recording' | 'stop-recording'
        config: msg.config,
      },
      '*',
    );
    sendResponse({ ok: true });
  }
});
```

### 5.4 Network Capture Module (`lib/network/capture.ts`)

References mcp-chrome's `network-capture-debugger.ts` pattern. Key adaptations:

```typescript
class NetworkCapture {
  private sessions = new Map<number, string>(); // tabId -> sessionId
  private db: IDBPDatabase<UnderPixelDB>;

  async start(tabId: number, sessionId: string, config: CaptureConfig): Promise<void> {
    // 1. Attach debugger via CDPSession manager (ref-counted)
    await cdpSession.attach(tabId, 'underpixel-network');

    // 2. Enable Network domain
    await cdpSession.sendCommand(tabId, 'Network.enable', {
      maxPostDataSize: 65536, // Capture POST bodies up to 64KB in events
    });

    // 3. Register this tab
    this.sessions.set(tabId, sessionId);
  }

  // CDP event handler (registered once in constructor)
  private async handleEvent(source: chrome.debugger.Debuggee, method: string, params: any) {
    const tabId = source.tabId;
    if (!tabId || !this.sessions.has(tabId)) return;
    const sessionId = this.sessions.get(tabId)!;

    switch (method) {
      case 'Network.requestWillBeSent':
        await this.onRequestStart(sessionId, tabId, params);
        break;
      case 'Network.responseReceived':
        await this.onResponseReceived(sessionId, tabId, params);
        break;
      case 'Network.loadingFinished':
        await this.onLoadingFinished(sessionId, tabId, params);
        break;
      case 'Network.loadingFailed':
        await this.onLoadingFailed(sessionId, tabId, params);
        break;
    }
  }

  private async onLoadingFinished(sessionId: string, tabId: number, params: any) {
    const requestId = params.requestId;
    // Fetch response body via CDP
    try {
      const { body, base64Encoded } = await cdpSession.sendCommand(
        tabId,
        'Network.getResponseBody',
        { requestId },
      );

      // Enforce size limit
      const bodyStr = base64Encoded ? body : body;
      if (bodyStr.length > MAX_RESPONSE_BODY_SIZE) {
        // Store truncated + ref note
      }

      // Write to IndexedDB
      await this.db.put('networkRequests', {
        ...existingRequest,
        responseBody: bodyStr.length <= INLINE_BODY_THRESHOLD ? bodyStr : undefined,
        responseBodyRef: bodyStr.length > INLINE_BODY_THRESHOLD ? requestId : undefined,
        status: 'complete',
        endTime: Date.now(),
      });

      // Notify correlation engine
      correlationEngine.onApiResponse(sessionId, requestId, Date.now());
    } catch (e) {
      // Response body may not be available (e.g., redirects, aborted)
    }
  }

  // Filtering logic
  private shouldCapture(url: string, type: string, config: CaptureConfig): boolean {
    // 1. Check resource type
    if (!config.includeStatic && !['XHR', 'Fetch', 'Document'].includes(type)) {
      return false;
    }
    // 2. Check domain blocklist
    const domain = new URL(url).hostname;
    if (config.excludeDomains.some((d) => domain.endsWith(d))) {
      return false;
    }
    // 3. Check domain allowlist (if set)
    if (config.includeDomains && !config.includeDomains.some((d) => domain.endsWith(d))) {
      return false;
    }
    return true;
  }
}
```

**Default excluded domains** (analytics/tracking):

```typescript
const DEFAULT_EXCLUDED_DOMAINS = [
  'google-analytics.com',
  'googletagmanager.com',
  'analytics.google.com',
  'mixpanel.com',
  'segment.io',
  'segment.com',
  'hotjar.com',
  'fullstory.com',
  'sentry.io',
  'bugsnag.com',
  'newrelic.com',
  'datadoghq.com',
  'facebook.net',
  'doubleclick.net',
  'adsservicegoogle.com',
];
```

### 5.5 Screenshot Gate (`lib/screenshot/gate.ts`)

Two-layer decision system for when to take automatic screenshots.

```typescript
class ScreenshotGate {
  private dirty = false;
  private stabilityTimer: number | null = null;
  private lastScreenshotTime = 0;
  private screenshotCount = 0;

  // Called by background when content script reports rrweb mutation events
  onDomMutation(sessionId: string, timestamp: number) {
    this.dirty = true;
    this.resetStabilityWait(sessionId);
  }

  // Called by background when content script reports layout-shift
  onLayoutShift(sessionId: string, value: number) {
    this.dirty = true;
    this.resetStabilityWait(sessionId);
  }

  // Called by correlation engine when API response received AND dom mutations followed
  onCorrelatedApiResponse(sessionId: string) {
    this.dirty = true;
    this.resetStabilityWait(sessionId);
  }

  // Called on URL/hash navigation — always capture, skip Layer 2
  async onNavigation(sessionId: string, tabId: number) {
    await this.captureScreenshot(sessionId, tabId, 'navigation', /* skipDiff */ true);
  }

  private resetStabilityWait(sessionId: string) {
    if (this.stabilityTimer) clearTimeout(this.stabilityTimer);

    this.stabilityTimer = setTimeout(async () => {
      if (!this.dirty) return;
      this.dirty = false;

      // Layer 1 passed: something changed + page is stable
      // Proceed to Layer 2 (or skip if config says 'auto')
      await this.evaluateScreenshot(sessionId);
    }, this.config.screenshotInterval); // debounce window (default 500ms)
  }

  private async evaluateScreenshot(sessionId: string) {
    const tabId = this.getTabId(sessionId);
    if (!tabId) return;

    // Check limits
    if (this.screenshotCount >= this.config.maxScreenshotsPerSession) return;
    if (Date.now() - this.lastScreenshotTime < this.config.screenshotInterval) return;

    if (this.config.pixelDiffThreshold === 'auto') {
      // Auto mode: skip pixel diff, trust rrweb + stability gate
      await this.captureScreenshot(sessionId, tabId, 'dom-mutation');
    } else {
      // Pixel diff mode: Layer 2
      await this.captureWithDiff(sessionId, tabId);
    }
  }

  private async captureWithDiff(sessionId: string, tabId: number) {
    const dataUrl = await chrome.tabs.captureVisibleTab({ format: 'png' });

    // Send to offscreen document for pixelmatch comparison
    const diffResult = await chrome.runtime.sendMessage({
      type: 'offscreen-diff',
      currentImage: dataUrl,
      sessionId,
    });

    if (diffResult.diffPercent > this.config.pixelDiffThreshold) {
      await this.saveScreenshot(sessionId, dataUrl, 'dom-mutation', diffResult.diffPercent);
    }
    // else: pixels didn't change enough, skip
  }
}
```

### 5.6 Offscreen Document (`offscreen.html`)

Handles canvas operations that service workers cannot do (no DOM/Canvas API in service workers).

**Responsibilities**:

- Receive screenshot as data URL from background
- Decode to canvas, extract ImageData
- Run pixelmatch against previous screenshot for same session
- Return diff percentage

```typescript
// offscreen/main.ts
import pixelmatch from 'pixelmatch';

const previousImages = new Map<string, ImageData>(); // sessionId -> last ImageData

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== 'offscreen-diff') return false;

  handleDiff(msg.sessionId, msg.currentImage).then(sendResponse);
  return true; // async response
});

async function handleDiff(sessionId: string, dataUrl: string): Promise<{ diffPercent: number }> {
  const img = await loadImage(dataUrl);
  const canvas = new OffscreenCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const currentData = ctx.getImageData(0, 0, img.width, img.height);

  const previous = previousImages.get(sessionId);
  previousImages.set(sessionId, currentData);

  if (!previous || previous.width !== currentData.width || previous.height !== currentData.height) {
    return { diffPercent: 100 }; // first screenshot or size changed
  }

  const diffPixels = pixelmatch(
    previous.data,
    currentData.data,
    null,
    currentData.width,
    currentData.height,
    { threshold: 0.1 },
  );

  const totalPixels = currentData.width * currentData.height;
  return { diffPercent: (diffPixels / totalPixels) * 100 };
}

async function loadImage(dataUrl: string): Promise<ImageBitmap> {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return createImageBitmap(blob);
}
```

**Offscreen document creation** (in background.ts):

```typescript
// Create offscreen document once, reuse
async function ensureOffscreenDocument() {
  const existing = await chrome.offscreen.hasDocument();
  if (!existing) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: [chrome.offscreen.Reason.CANVAS],
      justification: 'Image comparison for screenshot deduplication',
    });
  }
}
```

### 5.7 Replay Page (`replay/main.ts`)

Extension page opened as a Chrome tab (`chrome-extension://EXTENSION_ID/replay.html`).

**Layout**: Split pane — rrweb-player left, API timeline right, synced by timestamp.

```typescript
import Player from 'rrweb-player';
import 'rrweb-player/dist/style.css';

async function initReplay(sessionId: string) {
  const db = await openDB();

  // Load data from IndexedDB
  const events = await db.getAllFromIndex('rrwebEvents', 'by-session', sessionId);
  const requests = await db.getAllFromIndex('networkRequests', 'by-session', sessionId);
  const bundles = await db.getAllFromIndex('correlationBundles', 'by-session', sessionId);

  // Convert StoredRrwebEvent back to rrweb eventWithTime format
  const rrwebEvents = events.map((e) => ({
    type: e.type,
    data: e.data,
    timestamp: e.timestamp,
  }));

  // Mount rrweb-player
  const player = new Player({
    target: document.getElementById('player-container')!,
    props: {
      events: rrwebEvents,
      width: 800,
      height: 600,
      autoPlay: false,
      showController: true,
      speedOption: [1, 2, 4, 8],
    },
  });

  // Build API timeline
  const timeline = new ApiTimeline({
    container: document.getElementById('timeline-container')!,
    requests,
    bundles,
    onClickRequest: (request) => {
      // Seek player to the moment this API call completed
      const timeOffset = request.endTime - rrwebEvents[0].timestamp;
      player.goto(timeOffset);
    },
  });

  // Sync: as player plays, highlight current API calls in timeline
  const replayer = player.getReplayer();
  replayer.on('event-cast', (event: any) => {
    const currentTime = replayer.getCurrentTime() + rrwebEvents[0].timestamp;
    timeline.highlightAtTime(currentTime);
  });
}
```

**ApiTimeline** is a vanilla TS class that renders a scrollable list of API calls, each showing method, URL, status, duration. Clicking one seeks the player. Playing the player scrolls the timeline to show concurrent API calls.

### 5.8 Bridge — Native Messaging Host (`bridge/src/native-host.ts`)

Follows mcp-chrome's proven stdio protocol: **4-byte little-endian length prefix + JSON payload**.

```typescript
// native-host.ts
import { stdin, stdout } from 'process';

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (error: any) => void;
  timeout: NodeJS.Timeout;
}

class NativeMessagingHost {
  private pending = new Map<string, PendingRequest>();
  private buffer = Buffer.alloc(0);

  constructor() {
    stdin.on('data', (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.processBuffer();
    });
  }

  private processBuffer() {
    while (this.buffer.length >= 4) {
      const messageLength = this.buffer.readUInt32LE(0);
      if (this.buffer.length < 4 + messageLength) break;

      const messageJson = this.buffer.subarray(4, 4 + messageLength).toString('utf-8');
      this.buffer = this.buffer.subarray(4 + messageLength);

      const message = JSON.parse(messageJson);
      this.handleMessage(message);
    }
  }

  private handleMessage(message: NativeMessage) {
    if (message.responseToRequestId) {
      const pending = this.pending.get(message.responseToRequestId);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pending.delete(message.responseToRequestId);
        if (message.error) {
          pending.reject(new Error(message.error));
        } else {
          pending.resolve(message.payload);
        }
      }
    }
    // Handle extension-initiated messages (e.g., START server)
    if (message.type === 'start') {
      this.onStartServer(message.payload);
    }
  }

  sendToExtension(message: NativeMessage): void {
    const json = JSON.stringify(message);
    const buf = Buffer.from(json, 'utf-8');
    const header = Buffer.alloc(4);
    header.writeUInt32LE(buf.length, 0);
    stdout.write(Buffer.concat([header, buf]));
  }

  async callTool(name: string, args: any): Promise<any> {
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Tool call ${name} timed out after 120s`));
      }, 120_000);

      this.pending.set(requestId, { resolve, reject, timeout });
      this.sendToExtension({
        type: 'call_tool',
        requestId,
        payload: { name, args },
      });
    });
  }
}
```

### 5.9 Bridge — MCP Server (`bridge/src/mcp.ts`)

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { TOOL_SCHEMAS } from 'underpixel-shared';

export function createMcpServer(host: NativeMessagingHost): McpServer {
  const server = new McpServer({
    name: 'underpixel',
    version: '1.0.0',
  });

  // Register all tools from shared schema definitions
  for (const schema of TOOL_SCHEMAS) {
    server.tool(schema.name, schema.description, schema.inputSchema, async (params) => {
      try {
        const result = await host.callTool(schema.name, params);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (error: any) {
        return {
          content: [{ type: 'text', text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    });
  }

  return server;
}
```

### 5.10 Native Messaging Registration (`bridge/src/scripts/register.ts`)

Follows mcp-chrome's pattern exactly. Writes a manifest JSON to the OS-specific Native Messaging Hosts directory.

**Manifest written**:

```json
{
  "name": "com.underpixel.bridge",
  "description": "UnderPixel Bridge - MCP server for visual-API correlation",
  "path": "/absolute/path/to/run_host.sh",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://UNDERPIXEL_EXTENSION_ID/"]
}
```

**Platform paths** (user-level):
| Platform | Chrome Path |
|----------|-------------|
| Windows | `%APPDATA%\Google\Chrome\NativeMessagingHosts\com.underpixel.bridge.json` |
| macOS | `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.underpixel.bridge.json` |
| Linux | `~/.config/google-chrome/NativeMessagingHosts/com.underpixel.bridge.json` |

**Windows also**: Registry entry at `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.underpixel.bridge` pointing to the manifest path.

The wrapper scripts (`run_host.sh` / `run_host.bat`) handle Node.js discovery across version managers (nvm, fnm, volta, asdf) — direct port from mcp-chrome's battle-tested scripts.

### 5.11 Extension Manifest (generated by WXT)

```typescript
// wxt.config.ts
export default defineConfig({
  manifest: {
    name: 'UnderPixel',
    description: "Record, replay, and understand what's behind the pixels",
    permissions: [
      'nativeMessaging', // Bridge connection
      'tabs', // Tab info, captureVisibleTab
      'activeTab', // Access active tab
      'scripting', // Content script injection (for browser control tools)
      'debugger', // CDP network capture (REQUIRED)
      'offscreen', // Canvas image processing
      'storage', // chrome.storage.local for config/state
      'webNavigation', // URL change detection, frame enumeration
    ],
    host_permissions: ['<all_urls>'],
  },
});
```

**Permissions NOT requested** (unlike mcp-chrome):

- No `bookmarks`, `history` — not in scope
- No `downloads` — not needed
- No `contextMenus` — "Explain This Page" excluded from v1
- No `webRequest` — we use `debugger` (CDP) for network capture, which provides response bodies
- No `declarativeNetRequest`, `alarms`, `sidePanel` — not needed

Minimal permissions = smaller trust surface for users.

---

## 6. Correlation Engine

### 6.1 Core Algorithm

The correlation engine groups events that happen within a configurable time window into bundles. The anchor point is always an API response.

```typescript
class CorrelationEngine {
  private recentMutations: Map<string, MutationRecord[]> = new Map(); // sessionId -> recent mutations
  private db: IDBPDatabase<UnderPixelDB>;

  // Called when chrome.debugger reports a completed API response
  async onApiResponse(sessionId: string, requestId: string, timestamp: number) {
    const config = await this.getSessionConfig(sessionId);
    const window = config.correlationWindow; // default: 500ms

    // Wait for the correlation window to close
    // (DOM mutations may still be arriving from the API response rendering)
    setTimeout(async () => {
      await this.buildBundle(sessionId, requestId, timestamp, window);
    }, window);
  }

  // Called when content script sends rrweb incremental snapshot events
  onDomMutation(sessionId: string, event: StoredRrwebEvent) {
    if (event.type !== 3 /* IncrementalSnapshot */) return;
    const source = event.data?.source;
    // Only track DOM mutations (not mouse moves, scrolls, etc.)
    if (source !== 0 /* Mutation */) return;

    if (!this.recentMutations.has(sessionId)) {
      this.recentMutations.set(sessionId, []);
    }
    this.recentMutations.get(sessionId)!.push({
      timestamp: event.timestamp,
      adds: event.data.adds?.length || 0,
      removes: event.data.removes?.length || 0,
      texts: event.data.texts?.length || 0,
      attributes: event.data.attributes?.length || 0,
    });

    // Prune old mutations (keep only last 5 seconds)
    this.pruneOldMutations(sessionId, event.timestamp - 5000);
  }

  private async buildBundle(sessionId: string, requestId: string, apiTime: number, window: number) {
    const mutations = this.recentMutations.get(sessionId) || [];

    // Find DOM mutations within [apiTime, apiTime + window]
    const correlated = mutations.filter(
      (m) => m.timestamp >= apiTime && m.timestamp <= apiTime + window,
    );

    if (correlated.length === 0) return; // API response didn't cause visible DOM changes

    const request = await this.db.get('networkRequests', requestId);
    if (!request) return;

    const bundle: CorrelationBundle = {
      id: crypto.randomUUID(),
      sessionId,
      timestamp: apiTime,
      trigger: `${request.method} ${new URL(request.url).pathname}`,
      apiCalls: [requestId],
      rrwebEventIds: [], // filled by querying IndexedDB
      domMutationSummary: {
        addedNodes: correlated.reduce((sum, m) => sum + m.adds, 0),
        removedNodes: correlated.reduce((sum, m) => sum + m.removes, 0),
        textChanges: correlated.reduce((sum, m) => sum + m.texts, 0),
        attributeChanges: correlated.reduce((sum, m) => sum + m.attributes, 0),
      },
      correlation:
        `${request.method} ${shortUrl(request.url)} -> ` +
        `${correlated.reduce((s, m) => s + m.adds, 0)} nodes added, ` +
        `${correlated.reduce((s, m) => s + m.texts, 0)} text changes`,
    };

    await this.db.put('correlationBundles', bundle);

    // Notify screenshot gate that a correlated API response happened
    screenshotGate.onCorrelatedApiResponse(sessionId);
  }
}
```

### 6.2 Querying Correlations (`underpixel_correlate`)

When Claude Code asks "What API feeds the user table?", the `correlate` tool:

1. **Interpret the query**: Extract target — could be CSS selector (`#user-table`), text content (`"user table"`), or element description
2. **Find matching DOM content**: Search rrweb full snapshots and incremental mutations for elements matching the query (by ID, class, text content, or aria-label)
3. **Find correlation bundles**: Look up bundles whose rrweb events include mutations to those elements
4. **Return matched API calls**: Return the network requests referenced in those bundles

```typescript
async function correlate(query: string, sessionId?: string): Promise<CorrelateResult> {
  const session = sessionId ? await db.get('sessions', sessionId) : await getLatestSession();

  // Strategy 1: Query is a CSS selector
  if (query.startsWith('#') || query.startsWith('.') || query.includes('[')) {
    return correlateBySelector(query, session.id);
  }

  // Strategy 2: Query is free text — search API response bodies + DOM text
  return correlateByText(query, session.id);
}

async function correlateByText(query: string, sessionId: string): Promise<CorrelateResult> {
  const queryLower = query.toLowerCase();

  // Search network response bodies for the query text
  const requests = await db.getAllFromIndex('networkRequests', 'by-session', sessionId);
  const matchingApis = requests.filter((r) => {
    const body = r.responseBody || '';
    return body.toLowerCase().includes(queryLower);
  });

  // Search correlation bundles that reference these APIs
  const bundles = await db.getAllFromIndex('correlationBundles', 'by-session', sessionId);
  const matchingBundles = bundles.filter((b) =>
    b.apiCalls.some((id) => matchingApis.some((a) => a.requestId === id)),
  );

  return {
    query,
    matchedApiCalls: matchingApis.map(summarizeRequest),
    correlationBundles: matchingBundles,
    confidence: matchingBundles.length > 0 ? 'high' : 'medium',
  };
}
```

---

## 7. API Dependency Graph

### 7.1 Value Propagation Algorithm

Already defined in HIGHLEVEL doc. Implementation detail additions:

```typescript
function extractTrackableValues(responseBody: string): Map<string, ValueType> {
  const values = new Map<string, ValueType>();

  try {
    const parsed = JSON.parse(responseBody);
    walkJson(parsed, (key, value, path) => {
      if (typeof value === 'string') {
        // JWTs (eyJ prefix)
        if (value.startsWith('eyJ') && value.length > 30) {
          values.set(value, 'jwt');
        }
        // UUIDs
        else if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
          values.set(value, 'uuid');
        }
        // URLs/paths that look like API endpoints
        else if (value.startsWith('/api/') || value.startsWith('http')) {
          values.set(value, 'url');
        }
        // Long strings (tokens, session IDs, hashes)
        else if (value.length >= 20 && /^[A-Za-z0-9+/=_-]+$/.test(value)) {
          values.set(value, 'token');
        }
      }
      if (typeof value === 'number' && key.match(/id$/i)) {
        values.set(String(value), 'id');
      }
    });
  } catch {
    // Not JSON — skip
  }

  return values;
}

type ValueType = 'jwt' | 'uuid' | 'url' | 'token' | 'id';

interface DependencyEdge {
  from: { requestId: string; url: string; method: string };
  to: { requestId: string; url: string; method: string };
  via: string; // truncated value that links them
  valueType: ValueType;
  location: 'url' | 'header' | 'body'; // where in the target request
}
```

### 7.2 Performance

The algorithm is O(n^2) over requests within a session. With configurable request caps:

- 50 requests: ~1,225 comparisons, <10ms
- 200 requests: ~19,900 comparisons, <100ms
- 500 requests: ~124,750 comparisons, <500ms

No optimization needed for v1. If sessions grow beyond 500 requests, we can optimize by indexing trackable values in a Map for O(n) lookups instead of substring matching.

---

## 8. MCP Tool Specifications

### 8.1 Tool Schema Definitions

All tools prefixed with `underpixel_` to avoid naming collisions with other MCP servers.

```typescript
// packages/shared/src/tool-schemas.ts

export const TOOL_SCHEMAS = [
  // ──── Core (differentiator) ────
  {
    name: 'underpixel_correlate',
    description:
      'Find which API calls feed a specific UI element or content. ' +
      'Query can be a CSS selector (#user-table), text content ("user table"), ' +
      'or element description. Returns matched API calls with correlation details.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'CSS selector, text content, or element description',
        },
        sessionId: { type: 'string', description: 'Session ID (default: latest active session)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'underpixel_timeline',
    description:
      'Get a chronological timeline of snapshot bundles with correlated ' +
      'API calls + visual state changes. Returns correlation bundles ordered by timestamp.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        startTime: { type: 'number', description: 'Start timestamp (epoch ms)' },
        endTime: { type: 'number', description: 'End timestamp (epoch ms)' },
        limit: { type: 'number', description: 'Max bundles to return (default: 50)' },
      },
    },
  },
  {
    name: 'underpixel_snapshot_at',
    description:
      'Get the visual state + API calls + DOM state at a specific moment. ' +
      'Returns the closest screenshot, active API calls, and DOM snapshot.',
    inputSchema: {
      type: 'object',
      properties: {
        timestamp: { type: 'number', description: 'Target timestamp (epoch ms)' },
        sessionId: { type: 'string' },
      },
      required: ['timestamp'],
    },
  },

  // ──── Network ────
  {
    name: 'underpixel_capture_start',
    description:
      'Start recording network traffic + DOM changes + visual state on the active tab. ' +
      'Records all XHR/fetch calls with full request/response details. ' +
      'Shows "Chrome is being controlled" banner while active.',
    inputSchema: {
      type: 'object',
      properties: {
        filter: {
          type: 'object',
          properties: {
            includeStatic: {
              type: 'boolean',
              description: 'Include CSS/JS/images (default: false)',
            },
            excludeDomains: { type: 'array', items: { type: 'string' } },
            includeDomains: { type: 'array', items: { type: 'string' } },
          },
        },
        screenshotsEnabled: {
          type: 'boolean',
          description: 'Auto-capture screenshots (default: true)',
        },
        tabId: { type: 'number', description: 'Tab to capture (default: active tab)' },
      },
    },
  },
  {
    name: 'underpixel_capture_stop',
    description:
      'Stop capture and return a summary: API call count, correlation bundles found, ' +
      'screenshots taken, and session ID for further queries.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
      },
    },
  },
  {
    name: 'underpixel_api_calls',
    description:
      'Query captured API calls. Returns method, URL, status, timing, ' +
      'and optionally request/response bodies. Supports filtering by URL pattern, ' +
      'method, status code.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        urlPattern: { type: 'string', description: 'Filter by URL substring or glob' },
        method: { type: 'string', description: 'Filter by HTTP method' },
        statusCode: { type: 'number', description: 'Filter by status code' },
        includeBody: {
          type: 'boolean',
          description: 'Include request/response bodies (default: false, can be large)',
        },
        limit: { type: 'number', description: 'Max results (default: 50)' },
      },
    },
  },
  {
    name: 'underpixel_api_dependencies',
    description:
      'Auto-detect API call chains by tracking value propagation. ' +
      'Returns edge list showing how responses feed into subsequent requests ' +
      '(e.g., login token used in authorized API call).',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
      },
    },
  },

  // ──── Visual ────
  {
    name: 'underpixel_screenshot',
    description:
      'Take an on-demand screenshot of the current viewport. ' +
      'Always works regardless of auto-screenshot settings or limits.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: { type: 'number' },
        fullPage: {
          type: 'boolean',
          description: 'Capture full page (default: false, viewport only)',
        },
        selector: { type: 'string', description: 'CSS selector to capture specific element' },
      },
    },
  },
  {
    name: 'underpixel_dom_text',
    description:
      'Extract text content from elements matching a CSS selector. ' +
      'Quick way to read page content without a full screenshot.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector' },
        tabId: { type: 'number' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'underpixel_replay',
    description:
      'Open the replay viewer in a new browser tab. Shows rrweb session replay ' +
      'with synchronized API timeline panel. Returns the replay tab URL.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
      },
    },
  },

  // ──── Browser Control (minimal set) ────
  {
    name: 'underpixel_navigate',
    description: 'Navigate the active tab to a URL.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        tabId: { type: 'number' },
        newTab: { type: 'boolean', description: 'Open in new tab (default: false)' },
      },
      required: ['url'],
    },
  },
  {
    name: 'underpixel_interact',
    description: 'Perform a browser action: click, fill, scroll, or type.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['click', 'fill', 'scroll', 'type', 'press'],
          description: 'Action type',
        },
        selector: { type: 'string', description: 'CSS selector for target element' },
        value: { type: 'string', description: 'Value for fill/type actions' },
        key: { type: 'string', description: 'Key for press action (e.g., "Enter", "Tab")' },
        direction: { type: 'string', enum: ['up', 'down'], description: 'Scroll direction' },
        tabId: { type: 'number' },
      },
      required: ['action'],
    },
  },
  {
    name: 'underpixel_page_read',
    description:
      'Get an accessibility tree of visible elements on the page. ' +
      'Returns element types, text content, and interactive element identifiers.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: { type: 'number' },
        filter: {
          type: 'string',
          enum: ['all', 'interactive'],
          description: 'Element filter (default: all)',
        },
      },
    },
  },
];
```

### 8.2 Tool Response Design

All tool responses follow a consistent structure optimized for LLM consumption:

```typescript
// Responses are JSON objects with these conventions:
// - Include a "summary" field with human-readable overview
// - Keep data compact — no redundant fields
// - Timestamps as epoch milliseconds (not ISO strings — saves tokens)
// - Large bodies omitted by default, available on-demand with includeBody flag

// Example: underpixel_api_calls response
{
  summary: "12 API calls captured (10 success, 2 errors) over 3.2s",
  sessionId: "abc-123",
  calls: [
    {
      id: "req-1",
      method: "GET",
      url: "/api/users",
      status: 200,
      duration: 145,
      timestamp: 1712345678000,
      responseSize: 2048,
      // body omitted unless includeBody: true
    },
    // ...
  ]
}
```

---

## 9. Security Design

### 9.1 Threat Model

UnderPixel captures sensitive data by design (API responses, cookies visible in headers, page content). Key threats:

| Threat                                        | Risk                                                      | Mitigation                                                                                                                                                   |
| --------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Data exfiltration via bridge**              | Bridge could be modified to send data externally          | Bridge binds to `127.0.0.1` only. No outbound connections. Native Messaging manifest restricts to our extension ID.                                          |
| **Malicious MCP client reads sensitive data** | Any MCP client connected to the bridge can call tools     | User explicitly configures MCP client — this is intentional access. Tool responses only return what's explicitly requested.                                  |
| **Leaked response bodies**                    | API responses stored in IndexedDB may contain PII, tokens | IndexedDB is sandboxed per-extension. Data stays on disk, never transmitted. Sessions can be deleted. Auth headers are captured but never logged to console. |
| **Cross-extension attack**                    | Another extension tries to connect to our bridge          | Native Messaging `allowed_origins` restricts to our extension ID only.                                                                                       |
| **Content script pollution**                  | MAIN world script can be detected/interfered with by page | We namespace all postMessage with `source: 'underpixel-*'`. Minimal global footprint.                                                                        |
| **Bridge process hijacked**                   | Attacker replaces bridge binary                           | Bridge path is fixed in Native Messaging manifest. npm integrity checks protect the package.                                                                 |
| **Session export leaks data**                 | .underpixel files shared carelessly contain full API data | Export UI shows clear warning about sensitive data. Option to strip headers/bodies from export.                                                              |

### 9.2 Data Handling Rules

1. **All data stays local**: No telemetry, no cloud sync, no external API calls from the extension or bridge. Zero network connections except `127.0.0.1` for the MCP server.

2. **Sensitive header handling**:
   - `Authorization`, `Cookie`, `Set-Cookie` headers are captured (needed for dependency graph / auth flow detection)
   - These headers are **never** logged to console or included in error messages
   - Export function offers a "strip sensitive headers" option

3. **Response body storage**:
   - Stored in IndexedDB (per-extension sandbox, encrypted at rest by Chrome)
   - Auto-cleanup: sessions older than 7 days are deleted (configurable)
   - Manual delete: popup UI has "Clear all data" button

4. **Input masking**: `maskAllInputs` option in capture config (via rrweb's built-in masking). When enabled, form input values are replaced with `*****` in rrweb recordings. Disabled by default because the primary use case needs to see actual values.

5. **Domain filtering**: Users can configure `includeDomains` to capture ONLY specific domains, preventing accidental capture of unrelated API traffic.

### 9.3 Extension Permissions Justification

Each permission requested has a clear, necessary purpose:

| Permission          | Why Required                                         | What Happens Without It                                   |
| ------------------- | ---------------------------------------------------- | --------------------------------------------------------- |
| `debugger`          | CDP network capture with response bodies             | Cannot capture API response content — core feature broken |
| `nativeMessaging`   | Connect to bridge process                            | Cannot communicate with MCP clients                       |
| `tabs`              | Get tab info, captureVisibleTab                      | Cannot take screenshots or identify tabs                  |
| `activeTab`         | Access to current tab without broad host permissions | Would need broader permissions                            |
| `scripting`         | Inject helper scripts for click/fill/page-read tools | Browser control tools would not work                      |
| `offscreen`         | Canvas operations for pixelmatch                     | Cannot do pixel diffing for smart screenshots             |
| `storage`           | Persist config and state flags                       | Config lost on service worker restart                     |
| `webNavigation`     | Detect URL changes, enumerate frames                 | Cannot detect navigation events for screenshot trigger    |
| `<all_urls>` (host) | Content scripts need to run on any page              | Would only work on pre-declared domains                   |

### 9.4 Bridge Security

- **Localhost only**: Fastify server binds to `127.0.0.1`, never `0.0.0.0`. Not accessible from network.
- **No authentication on MCP endpoint**: Follows same pattern as mcp-chrome. Since it's localhost-only, authentication would add complexity without meaningful security (any local process can connect to any local port). If users need auth, they can use stdio transport instead (MCP client spawns bridge directly, no HTTP server exposed).
- **No CORS for external origins**: CORS configured to only allow same-origin. MCP clients use server-to-server HTTP, not browser requests.

---

## 10. Implementation Plan

### Phase 1: Skeleton + Network Capture + MCP (Days 1-2) ✅ COMPLETE

**Goal**: Extension loads, bridge connects, one MCP tool works end-to-end.

**Steps**:

1. **Scaffold monorepo**
   - `pnpm init` + workspace config
   - Create `extension/`, `bridge/`, `packages/shared/` directories
   - Set up `tsconfig.base.json`, shared ESLint config
   - WXT init in `extension/`: `pnpm dlx wxt@latest init`

2. **Shared types package**
   - Define `NativeMessage`, `NativeMessageType`, tool name constants
   - Define `TOOL_SCHEMAS` with just `underpixel_capture_start` and `underpixel_api_calls`

3. **Bridge — Native Messaging host**
   - Implement `native-host.ts` (length-prefixed JSON stdio protocol)
   - Implement `register.ts` (write NativeMessagingHosts manifest)
   - Port `run_host.sh` / `run_host.bat` from mcp-chrome (adapt paths/names)
   - Implement `postinstall.ts`
   - Implement `cli.ts` with `register` command

4. **Bridge — MCP server**
   - Implement `server.ts` (Fastify, `/mcp` and `/ping` routes)
   - Implement `mcp.ts` (McpServer with tool proxy)
   - Wire: native host receives `START` from extension → starts HTTP server

5. **Extension — Background + Native Messaging**
   - `background.ts`: initialize, connect to native host via `chrome.runtime.connectNative`
   - `lib/native/host.ts`: port management, message routing, reconnection
   - `lib/tools/registry.ts`: tool name → handler dispatch

6. **Extension — Network capture (CDP)**
   - `lib/network/cdp-session.ts`: ref-counted debugger attach/detach
   - `lib/network/capture.ts`: CDP event handlers, request/response storage
   - `lib/tools/network.ts`: `capture_start` and `api_calls` handlers

7. **Extension — IndexedDB**
   - `lib/storage/db.ts`: schema definition with `idb`, migration v1

8. **Extension — Minimal popup**
   - Toggle capture on/off, show connection status

**Verification**:

```bash
# 1. Build and install
cd bridge && pnpm build && npm install -g .
cd extension && pnpm dev  # WXT dev mode with HMR

# 2. Load extension in Chrome, click Connect
# 3. Configure Claude Code:
#    { "mcpServers": { "underpixel": { "type": "streamableHttp", "url": "http://127.0.0.1:PORT/mcp" } } }

# 4. In Claude Code:
#    "Start capturing network on the active tab"
#    → underpixel_capture_start()
#    "Show me the API calls"
#    → underpixel_api_calls()
#    Verify: see list of captured XHR/fetch requests with headers and bodies
```

### Phase 2: rrweb Recording + Correlation (Days 3-4) ✅ FUNCTIONALLY COMPLETE

**Goal**: DOM recording works, correlation engine produces bundles.

**Steps**:

1. ✅ **Content scripts**
   - `content-recorder.ts` (MAIN world): rrweb.record() + PerformanceObserver
   - `content.ts` (ISOLATED world): postMessage bridge to background
   - Wire: background sends start/stop commands, receives rrweb events

2. ✅ **Recording manager** (different file structure than planned)
   - `lib/recording/session.ts` → session lifecycle split across `tools/network.ts` (capture_start/stop) and `background.ts`
   - `lib/recording/events.ts` → implemented as `lib/recording/event-batcher.ts` (200ms batched writes to IndexedDB)
   - No standalone session manager module — session creation/config is inline in capture_start

3. ✅ **Correlation engine**
   - `lib/correlation/engine.ts`: timestamp matching logic
   - `lib/correlation/types.ts` → types live in `packages/shared/src/types.ts` (CorrelationBundle, etc.)
   - Wire: network capture notifies engine on API response, engine checks for recent DOM mutations

4. ✅ **Core MCP tools**
   - `underpixel_correlate`: query by text/selector → find matching API calls
   - `underpixel_timeline`: return chronological bundles
   - `underpixel_capture_stop`: stop capture, return summary with correlation count

**Verification**:

```bash
# In Claude Code:
# "Go to [any web app], start capture, click around, then tell me
#  what API feeds the [specific UI element]"
# → underpixel_capture_start()
# → underpixel_navigate(url)
# → [user interacts or AI clicks]
# → underpixel_correlate("user table")
# Verify: returns correlated API calls with DOM mutation summary
```

### Phase 3: Smart Screenshots + Replay UI (Days 5-7) — PARTIALLY COMPLETE

**Goal**: Screenshots taken intelligently, replay page works.

**Steps**:

1. **Offscreen document** — NOT YET
   - `offscreen.html` + handler for pixelmatch diffing
   - Background creates offscreen doc on first screenshot need

2. **Screenshot gate** — NOT YET
   - `lib/screenshot/gate.ts`: 2-layer decision logic
   - `lib/screenshot/capture.ts`: captureVisibleTab wrapper with rate limiting
   - Wire: rrweb mutations + layout shifts → gate → offscreen diff → save

3. ✅ **On-demand screenshot tool**
   - `underpixel_screenshot`: always works, bypasses gate limits
   - Support viewport and full-page (scroll-stitch from mcp-chrome pattern)

4. **Replay page** — NOT YET (stub exists: `underpixel_replay` opens tab, but replay UI not built)
   - `replay.html` + `replay/main.ts`: mount rrweb-player
   - API timeline panel: scrollable list synced with player
   - Click API call → seek player; play → scroll timeline
   - `underpixel_replay` tool: opens replay tab, returns URL

5. ✅ **Additional tools**
   - `underpixel_snapshot_at`: nearest screenshot + API calls at timestamp
   - `underpixel_dom_text`: extract text via injected content script

**Verification**:

```bash
# 1. Start capture on a dynamic web app (dashboard, etc.)
# 2. Interact with the page for 30 seconds
# 3. Stop capture
# 4. Call underpixel_replay()
# Verify: replay tab opens, shows DOM replay left + API calls right
# Click an API call → player seeks to that moment
# Screenshots were taken automatically at visual change points
```

### Phase 4: Browser Control + Dependency Graph + Export (Days 8-10) — PARTIALLY COMPLETE

**Goal**: Full tool surface, dependency detection, session export.

**Steps**:

1. ✅ **Browser control tools**
   - `underpixel_navigate`: chrome.tabs.update / chrome.tabs.create
   - `underpixel_interact`: inject click/fill/scroll/type helper scripts
   - `underpixel_page_read`: inject accessibility tree helper

2. ✅ **API dependency graph**
   - Value propagation algorithm in `lib/tools/core.ts` (extractTrackableValues + walkJson)
   - `underpixel_api_dependencies` tool: returns edge list with JWT/UUID/token/ID tracking

3. **Session export/import** — NOT YET
   - `lib/storage/export.ts`: gather all data → JSON → gzip → .underpixel
   - Export button in replay UI
   - Import: open .underpixel file → load into fresh IndexedDB session

4. ✅ **Popup improvements** (partial)
   - Show active session stats (request count, screenshot count, correlations)
   - Domain filter configuration — NOT YET
   - Session list with delete option — NOT YET

**Verification**:

```bash
# 1. Claude Code: "Navigate to [login page], log in, then show me the auth flow"
# → underpixel_navigate, underpixel_interact (fill + click)
# → underpixel_api_dependencies()
# Verify: returns edge list showing login → token → authorized API call chain

# 2. Export session, verify .underpixel file contains all data
# 3. Import in a separate browser profile, verify replay works
```

### Phase 5: Polish + Edge Cases (Days 11-12)

1. **Service worker restart resilience**: test capture survives SW restart
2. **Error handling**: graceful degradation on debugger conflicts, permission denials
3. **Config persistence**: capture settings saved to chrome.storage.local
4. **Loading states**: popup shows "connecting...", "capturing...", etc.
5. **Session auto-cleanup**: delete sessions > 7 days old on startup
6. **Large session handling**: test with 200+ API calls, verify IndexedDB performance

---

## 11. Edge Cases & Mitigations

| Edge Case                                | Impact                                                                       | Mitigation                                                                                                                                                                                                                 |
| ---------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **DevTools open while capturing**        | chrome.debugger cannot attach if DevTools has Network panel open on same tab | Detect and show clear error: "Close DevTools or open it without Network panel". Auto-retry on debugger detach.                                                                                                             |
| **Service worker suspended mid-capture** | Capture state lost                                                           | All state in IndexedDB. On restart, check `captureActive` flag in chrome.storage.local, re-attach debugger, resume capture. Native Messaging port keeps SW alive during active sessions.                                   |
| **Page navigates during capture**        | rrweb recording for old page ends, new page needs fresh recording            | Listen for `webNavigation.onCommitted`. Stop rrweb on old page, inject + start on new page. Create navigation correlation bundle. CDP network capture continues across navigations (debugger attached to tab, not page).   |
| **Cross-origin iframes**                 | rrweb may not record iframe content                                          | Use rrweb's `recordCrossOriginIframes: true`. Content scripts run in all frames (`all_frames: true` in WXT config). Some cross-origin iframes will still be opaque — acceptable limitation.                                |
| **Very large API responses (>1MB)**      | Storage bloat, slow tool responses                                           | Truncate at 1MB with marker. Store summary (size, content-type, first 1KB) for all responses, full body only if under limit.                                                                                               |
| **Rapid API calls (100+/sec)**           | IndexedDB write bottleneck                                                   | Batch writes: accumulate for 200ms, bulk-put. For correlation, only process XHR/fetch (not static resources by default).                                                                                                   |
| **Long capture sessions (hours)**        | Memory/storage exhaustion                                                    | Configurable `maxScreenshotsPerSession` (default 100). rrweb events streamed to IndexedDB, not held in memory. Network requests capped at configurable limit (default 500). Session auto-stop after configurable max time. |
| **Multiple tabs open**                   | Which tab to capture?                                                        | Capture is per-tab, explicitly started on a specific tabId. Multiple simultaneous captures supported (separate sessions).                                                                                                  |
| **Extension update during capture**      | Service worker replaced                                                      | Capture stops gracefully. User restarts. Future: save/restore capture state.                                                                                                                                               |
| **WebSocket traffic**                    | Not captured by `Network.requestWillBeSent`                                  | Out of scope for v1. CDP supports `Network.webSocketFrameReceived` — can add in v2 if needed.                                                                                                                              |
| **Response body unavailable**            | Redirects, aborted requests, opaque responses                                | `Network.getResponseBody` may throw. Catch error, mark request as `bodyUnavailable: true`. Don't fail the whole capture.                                                                                                   |
| **pixelmatch size mismatch**             | Viewport resized between screenshots                                         | If dimensions differ, treat as 100% changed (always save). Reset previous-image reference.                                                                                                                                 |

---

## 12. Testing & Verification Strategy

### 12.1 Unit Tests (vitest)

```
extension/test/
├── correlation/
│   ├── engine.test.ts        # Timestamp matching, bundle building
│   └── query.test.ts         # Text/selector correlation queries
├── dependency/
│   └── graph.test.ts         # Value propagation algorithm
├── screenshot/
│   └── gate.test.ts          # Layer 1/2 decision logic
├── storage/
│   └── db.test.ts            # IndexedDB operations (fake-indexeddb)
├── network/
│   └── capture.test.ts       # Request filtering, body handling
└── tools/
    └── schemas.test.ts       # Tool schema validation

bridge/test/
├── native-host.test.ts       # Length-prefixed protocol parsing
├── mcp.test.ts               # Tool proxy, error handling
└── server.test.ts            # HTTP routes
```

**Key testing patterns**:

- Use `fake-indexeddb` for storage tests (same as mcp-chrome)
- Mock `chrome.*` APIs with `@anthropic-ai/test-utils` or manual mocks
- Correlation engine tests use synthetic event streams with known timestamps
- Dependency graph tests use crafted request/response sequences

### 12.2 Integration Tests

**Manual E2E test script** (run before each release):

```markdown
## E2E Test Checklist

### Setup

- [ ] Build extension: `cd extension && pnpm build`
- [ ] Build bridge: `cd bridge && pnpm build && npm install -g .`
- [ ] Load extension in Chrome
- [ ] Configure Claude Code with underpixel MCP server

### Network Capture

- [ ] Start capture on a web app with API calls
- [ ] Verify XHR/fetch requests captured with bodies
- [ ] Verify static resources excluded by default
- [ ] Verify domain filtering works
- [ ] Stop capture, verify summary

### Correlation

- [ ] On a data-driven page, ask "what API feeds [visible element]"
- [ ] Verify correct API calls identified
- [ ] Verify correlation bundles have mutation summaries

### Screenshots

- [ ] Verify auto-screenshots taken on visual changes
- [ ] Verify screenshot limit respected
- [ ] Verify on-demand screenshot works beyond limit
- [ ] Verify pixel diff mode filters unchanged screenshots

### Replay

- [ ] Open replay viewer
- [ ] Verify rrweb playback matches original page
- [ ] Verify API timeline synced with playback
- [ ] Click API call → player seeks correctly

### Browser Control

- [ ] Navigate to URL via MCP tool
- [ ] Click element via MCP tool
- [ ] Fill form field via MCP tool
- [ ] Read page content via MCP tool

### Export/Import

- [ ] Export session as .underpixel file
- [ ] Verify file contains all data (events, requests, screenshots)
- [ ] Import in fresh profile, verify replay works

### Edge Cases

- [ ] Start capture → close DevTools → verify capture works
- [ ] Start capture → navigate to new page → verify capture continues
- [ ] Long session (5 min) → verify no memory issues
- [ ] Multiple rapid API calls → verify no dropped requests
```

### 12.3 Automated Smoke Test

A single script that verifies the full pipeline:

```typescript
// test/smoke.ts — run via Claude Code or programmatically
// Requires: extension loaded, bridge running, MCP configured

async function smokeTest(mcpClient: McpClient) {
  // 1. Start capture
  const startResult = await mcpClient.callTool('underpixel_capture_start', {});
  assert(startResult.sessionId);

  // 2. Navigate to test page
  await mcpClient.callTool('underpixel_navigate', {
    url: 'https://jsonplaceholder.typicode.com/todos',
  });
  await sleep(2000);

  // 3. Query API calls
  const calls = await mcpClient.callTool('underpixel_api_calls', {
    sessionId: startResult.sessionId,
  });
  assert(calls.calls.length > 0, 'Should capture at least one API call');

  // 4. Take screenshot
  const screenshot = await mcpClient.callTool('underpixel_screenshot', {});
  assert(screenshot.dataUrl, 'Should return screenshot data');

  // 5. Stop capture
  const stopResult = await mcpClient.callTool('underpixel_capture_stop', {
    sessionId: startResult.sessionId,
  });
  assert(stopResult.stats.networkRequestCount > 0);

  // 6. Query correlations
  const corr = await mcpClient.callTool('underpixel_correlate', {
    query: 'todo',
    sessionId: startResult.sessionId,
  });
  // May or may not find correlations depending on page structure

  console.log('Smoke test passed!');
}
```

---

## Appendix A: Default Capture Config

```typescript
const DEFAULT_CAPTURE_CONFIG: CaptureConfig = {
  // Network
  includeStatic: false,
  excludeDomains: DEFAULT_EXCLUDED_DOMAINS,
  maxResponseBodySize: 1_048_576, // 1MB

  // Screenshots
  screenshotsEnabled: true,
  maxScreenshotsPerSession: 100,
  screenshotInterval: 500,
  pixelDiffThreshold: 'auto',

  // Correlation
  correlationWindow: 500,

  // rrweb
  rrwebSampling: {
    mousemove: 100,
    scroll: 150,
    input: 'last',
  },
  maskInputs: false,
};
```

## Appendix B: Native Message Protocol

```
┌──────────────────────────────────────────────────────────┐
│  4 bytes (UInt32LE)  │  N bytes (UTF-8 JSON)            │
│  Message length      │  NativeMessage payload            │
└──────────────────────────────────────────────────────────┘

NativeMessage = {
  type?: 'start' | 'server_started' | 'call_tool' | 'ping' | 'stop';
  requestId?: string;            // UUID, set for request/response pairs
  responseToRequestId?: string;  // Matches a previous requestId
  payload?: any;                 // Tool args (request) or result (response)
  error?: string;                // Error message if failed
}

Flow:
1. Chrome launches bridge via Native Messaging
2. Extension sends: { type: 'start', payload: { port: 12307 } }
3. Bridge starts Fastify on 127.0.0.1:12307
4. Bridge responds: { type: 'server_started', payload: { port: 12307 } }
5. MCP client connects to http://127.0.0.1:12307/mcp
6. MCP client calls tool → bridge sends: { type: 'call_tool', requestId: 'uuid', payload: { name, args } }
7. Extension executes tool, responds: { responseToRequestId: 'uuid', payload: result }
8. Bridge returns MCP result to client
```

## Appendix C: rrweb Event Processing Pipeline

```
Page DOM changes
    │
    ▼
rrweb.record() [MAIN world]
    │ emit(event)
    ▼
window.postMessage [→ ISOLATED world content.ts]
    │
    ▼
chrome.runtime.sendMessage [→ background]
    │
    ├──▶ Recording Manager
    │      │
    │      ├─ Batch buffer (200ms window)
    │      └─ Bulk write to IndexedDB (rrwebEvents store)
    │
    ├──▶ Correlation Engine (if IncrementalSnapshot + Mutation source)
    │      │
    │      └─ Track recent mutations, check against pending API responses
    │
    └──▶ Screenshot Gate (if IncrementalSnapshot)
           │
           ├─ Set dirty flag
           ├─ Reset stability timer
           └─ On stability: evaluate → [optional pixelmatch] → save
```
