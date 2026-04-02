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

- **Phase 1: COMPLETE** — 13 MCP tools, network capture, rrweb recording, correlation engine, bridge, popup, 86 tests.
- **Phase 2: NOT STARTED** — Smart screenshot gate (pixelmatch), offscreen document, replay UI (rrweb-player).
- **Phase 3: PARTIAL** — `api_dependencies` tool done. Session export/import not started.

## Design docs

- `docs/UNDERPIXEL_HIGHLEVEL.md` — Vision, competitive landscape, build phases
- `docs/UNDERPIXEL_TECH_DESIGN.md` — Data models, component specs, IDB schema
