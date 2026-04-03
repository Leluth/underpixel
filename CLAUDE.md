# UnderPixel

Chrome extension + MCP server for visual-API correlation. Monorepo: `extension/` (Chrome MV3, WXT), `bridge/` (Native Messaging + Fastify MCP server), `packages/shared/` (types, constants, tool schemas).

## Commands

```bash
pnpm install          # from root
pnpm build            # builds all (shared → bridge → extension)
pnpm dev              # WXT dev mode with HMR
pnpm test             # vitest across all packages
pnpm lint             # ESLint
pnpm format:check     # Prettier check
```

## Workflow

- After completing a batch of code changes, run `pnpm lint` and `pnpm test` before reporting done.

## Non-obvious conventions

- **Network capture requires `chrome.debugger` (CDP)** — `chrome.webRequest` cannot read response bodies. This is intentional.
- **rrweb runs in MAIN world** content script, bridged to ISOLATED world via `window.postMessage` — this dual-world pattern is required because rrweb needs real DOM access but `chrome.runtime` only works in ISOLATED world.
- **Response bodies** stored inline if <100KB, otherwise in separate `responseBodies` IDB store via `responseBodyRef`. Don't change these thresholds without updating both `capture.ts` and `api_calls` tool.
- **Don't modify `packages/shared/src/types.ts` lightly** — both extension and bridge depend on it.
- Don't commit/push unless explicitly asked.

## Status

- **Phase 1: COMPLETE** — 13 MCP tools, network capture, rrweb recording, correlation engine, bridge, popup.
- **Phase 2: PARTIAL** — Replay UI done (Svelte + rrweb-player, Cozy Pixel RPG theme, event-based timeline, detail panel, search/filter). Smart screenshot gate (pixelmatch) + offscreen document still pending.
- **Phase 3: PARTIAL** — `api_dependencies` tool done. Session export/import not started.
- **132 tests** across all packages (extension: 101, shared: 19, bridge: 12).

## Replay UI (Phase 2)

The replay page (`entrypoints/replay/`) uses **Svelte 5** in legacy mode (Svelte 4 syntax: `$:`, `export let`, `createEventDispatcher`). This is intentional — Svelte 5 supports Svelte 4 syntax in components that don't use runes. The `mount()` API in `main.ts` is Svelte 5. If migrating to runes, convert all components in one pass. All other entrypoints remain vanilla TS.

Key patterns:

- **Event-based timeline** — The API panel groups calls by UI events (CLICK, INPUT, SCROLL, PAGE UPDATE), not individual API calls. `buildEventSections()` in `src/replay/lib/event-sections.ts` pre-computes `EventSection[]` once at session load by scanning rrweb events for user interactions and attaching correlation bundles + background requests by temporal proximity (2s window). See the JSDoc on `buildEventSections` for the full algorithm.
- `src/replay/stores/` — Svelte writable stores. Scrubber uses direct DOM updates via `replayStore.subscribe()` in `onMount` to avoid Svelte re-render on every frame.
- `src/replay/components/EventGroup.svelte` — Renders one event section: clickable header (seeks player 200ms before event), DOM summary, correlated API calls, collapsed background calls sub-group.
- `src/replay/components/Player.svelte` — rrweb-player wrapper. Tracks `desiredPlaying` state independently of player's internal state. Recreates player on seek failure (cross-origin DOM corruption). Play/pause and seeking are fully decoupled.
- `src/replay/lib/` — Pure logic (search, format, event-sections, group-naming, theme) with tests.
- Capture survives page navigation via `chrome.tabs.onUpdated` (status:'complete') listener that re-attaches debugger and re-sends `start-recording` to fresh content scripts.

### Svelte 4 store caveat

In Svelte 4 legacy mode, `$store.anyProp` subscribes to the **entire** store — not just that property. This means `$replayStore.allRequests` in a `$:` block fires on every `setCurrentTime` tick (60Hz). Avoid reading `$replayStore` inside reactive blocks that don't need `currentTime`. Derive from other reactive variables or pre-computed data (e.g. `eventSections`, `visibleSections`) instead.

### Correlation engine optimizations

- **100ms backward buffer** on the correlation window (`PRE_CORRELATION_BUFFER`) — accounts for CDP event delivery latency where DOM mutations can have timestamps slightly before `apiTime`.
- **Window caching** — correlation window config read from IDB once per session, not per API call.
- **Batched stats** — `networkRequestCount` and `correlationBundleCount` tracked in memory, flushed to IDB in a single write on session stop.
- **Request info pass-through** — `onApiResponse` accepts `{ method, url }` so `buildBundle` doesn't re-read from IDB.
- **Static imports** in `background.ts` and `capture.ts` for hot-path modules (was dynamic `import()` per event).

### rrweb guide alignment

- `checkoutEveryNms: 5000` enabled in content-recorder — gives the replayer periodic full snapshots for reliable seeking (per rrweb guide recommendation)
- `inlineStylesheet: true` is the default and we don't override it
- `inlineImages: false` — not enabled because it's broken in this alpha (rrweb-io/rrweb#1218). Enable when fixed.
- Using legacy `rrweb` package + `rrweb-player`, not the newer `@rrweb/record` + `@rrweb/replay`. Migrate when upgrading to stable v2.
- Player calls `replayer.destroy()` on cleanup (per guide). The `rrweb-player` wrapper doesn't expose destroy directly, so we call `player.getReplayer()?.destroy()`.

### Known limitation: rrweb seek on cross-origin-heavy pages

`player.goto()` can crash on pages with many cross-origin images (e.g. reqres.in). Root cause: rrweb-player rebuilds DOM from snapshot during seek, which triggers cross-origin resource loads in the sandboxed iframe, causing DOM manipulation errors (`removeChild`, `insertBefore` on non-existent nodes). Sequential playback (`play()`) works reliably. Tracked upstream: rrweb-io/rrweb#1218 (`inlineImages` broken — images not inlined at recording time), rrweb-io/rrweb#1202 (no proxy option for replay). Fix: when rrweb fixes `inlineImages` or we upgrade to a stable v2, enable image inlining during capture so replay doesn't fetch cross-origin.

## Design docs

- `docs/UNDERPIXEL_HIGHLEVEL.md` — Vision, competitive landscape, build phases
- `docs/UNDERPIXEL_TECH_DESIGN.md` — Data models, component specs, IDB schema
- `docs/superpowers/specs/2026-04-02-replay-ui-design.md` — Replay UI design spec (Phase 2)
- `docs/superpowers/plans/2026-04-02-replay-ui.md` — Replay UI implementation plan (Phase 2)
- `docs/superpowers/specs/2026-04-02-timeline-panel-redesign.md` — Timeline panel chronological ordering + muted background calls
- `docs/superpowers/specs/2026-04-03-event-based-timeline-design.md` — Event-based timeline redesign spec
- `docs/superpowers/plans/2026-04-03-event-based-timeline.md` — Event-based timeline implementation plan
