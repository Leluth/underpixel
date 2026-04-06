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

- Run `pnpm lint` and `pnpm test` before reporting done.
- Don't commit/push unless explicitly asked.

## Non-obvious conventions

- **Network capture requires `chrome.debugger` (CDP)** — `chrome.webRequest` cannot read response bodies.
- **rrweb runs in MAIN world** content script, bridged to ISOLATED world via `window.postMessage` — rrweb needs real DOM access but `chrome.runtime` only works in ISOLATED world.
- **Response bodies** stored inline if <100KB, otherwise in separate `responseBodies` IDB store via `responseBodyRef`. Don't change these thresholds without updating both `capture.ts` and `api_calls` tool.
- **Don't modify `packages/shared/src/types.ts` lightly** — both extension and bridge depend on it.
- **Replay UI uses Svelte 5 in legacy mode** (Svelte 4 syntax). If migrating to runes, convert all components in one pass.
- **Svelte 4 store caveat** — `$store.anyProp` subscribes to the entire store. Avoid reading `$replayStore` in reactive blocks that don't need `currentTime` (fires at 60Hz).
- **rrweb `inlineImages: false`** — broken in this alpha (rrweb-io/rrweb#1218). Causes seek crashes on cross-origin-heavy pages. Enable when fixed.

## Design docs

See `docs/` — includes high-level vision, tech design, and per-feature specs/plans in `docs/superpowers/`.
