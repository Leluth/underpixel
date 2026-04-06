# Phase 3: Session Export/Import Design

**Date:** 2026-04-06
**Status:** Approved
**Scope:** `.underpixel` file format, export from replay UI, import via file picker

## Overview

Enable users to export captured sessions as self-contained `.underpixel` files and import them back into the replay UI. Exported files contain all session data (rrweb events, network requests with response bodies, screenshots, correlation bundles) in a single gzipped JSON blob. Imported sessions become first-class citizens in IndexedDB alongside captured sessions.

**Primary use cases:**

- Team sharing ("look at this bug I captured")
- Personal archival (save sessions for later analysis)
- AI handoff (attach session context to a new Claude Code conversation)

## File Format

### `.underpixel` Bundle Structure

```typescript
interface UnderpixelBundle {
  version: 1;
  exportedAt: number; // Epoch ms
  exportOptions: ExportOptions;

  session: CaptureSession;
  networkRequests: NetworkRequest[];
  rrwebEvents: StoredRrwebEvent[];
  screenshots: StoredScreenshot[];
  correlationBundles: CorrelationBundle[];
}

interface ExportOptions {
  includeScreenshots: boolean; // Default: true
  includeResponseBodies: boolean; // Default: true
  maskSensitiveHeaders: boolean; // Default: false
  maskedHeaderNames: string[]; // e.g. ['authorization', 'cookie', 'set-cookie']
}
```

### Design Decisions

- **Response bodies are re-inlined:** During export, `responseBodyRef` entries are resolved from the `responseBodies` IDB store and placed back into `responseBody`. The exported format is fully self-contained.
- **Version field:** Enables forward-compatible parsing. Import rejects unknown versions with a clear error message.
- **Compression:** Browser-native `CompressionStream('gzip')` / `DecompressionStream('gzip')`. Zero external dependencies. Typical rrweb data compresses ~10:1.
- **File extension:** `.underpixel` — always opened through the replay UI file picker.

## Export Flow

### User Interaction

1. User clicks **Export** button in replay UI header (existing stub at `App.svelte:124`).
2. Options modal appears with toggles:
   - **Include screenshots** (default: on)
   - **Include response bodies** (default: on)
   - **Mask sensitive headers** (default: off) — when toggled on, reveals an editable list with defaults: `authorization, cookie, set-cookie, x-api-key`
3. User clicks "Export" in modal to confirm.

### Processing

1. **Read from IDB:** Fetch all data for the current session:
   - Session record from `sessions`
   - All requests from `networkRequests` (by `by-session` index)
   - All response bodies from `responseBodies` (by `by-session` index)
   - All rrweb events from `rrwebEvents` (by `by-session` index)
   - All screenshots from `screenshots` (by `by-session` index)
   - All correlation bundles from `correlationBundles` (by `by-session` index)

2. **Re-inline response bodies:** For each request with a `responseBodyRef`, look up the body from the `responseBodies` results, set `responseBody` to the value, and delete `responseBodyRef`.

3. **Apply export options:**
   - If `includeScreenshots` is false: set `screenshots` to empty array, clear `screenshotId` from correlation bundles.
   - If `includeResponseBodies` is false: clear `responseBody` from all requests.
   - If `maskSensitiveHeaders` is true: for each header name in `maskedHeaderNames`, replace the value with `"[MASKED]"` in both `requestHeaders` and `responseHeaders` of all requests.

4. **Assemble bundle:** Create `UnderpixelBundle` object with version, timestamp, options, and all data.

5. **Compress & download:**
   - `JSON.stringify` the bundle.
   - Encode to UTF-8 via `TextEncoder`.
   - Pipe through `new CompressionStream('gzip')`.
   - Collect output chunks into a `Blob`.
   - Trigger download via temporary `<a>` element with `URL.createObjectURL`.
   - Filename: `{initialTitle}-{YYYY-MM-DD}.underpixel` (derived from `session.initialTitle`, sanitized for filesystem safety: replace non-alphanumeric chars with hyphens, collapse runs, trim to 60 chars).

### Progress Indication

Button shows "Exporting..." state (disabled, text swap) during processing. No progress bar — typical sessions complete in under a second.

## Import Flow

### User Interaction

1. User clicks **Import** button in replay UI header (new button next to Export).
2. Native file picker opens with `.underpixel` filter.
3. On success, the imported session is auto-selected in the session picker.

### Processing

1. **Decompress:** Read file as `ReadableStream`, pipe through `DecompressionStream('gzip')`, collect into a string.

2. **Parse & validate:** `JSON.parse` the result. Validate:
   - `version` field exists and equals `1`.
   - `session` object has required fields (`id`, `startTime`, `initialUrl`).
   - `networkRequests`, `rrwebEvents`, `screenshots`, `correlationBundles` are arrays.

3. **Re-key:** Generate a new UUID for the session. Update `sessionId` references across all records:
   - All `networkRequests[].sessionId`
   - All `rrwebEvents[].sessionId`
   - All `screenshots[].sessionId`
   - All `correlationBundles[].sessionId`

4. **Mark as imported:** Add to the session record:
   - `imported: true`
   - `importedAt: Date.now()`
   - `originalSessionId: <original session id>`

5. **Write to IDB:** In a single transaction across all stores:
   - Session to `sessions`
   - Requests to `networkRequests` (bodies >100KB split back into `responseBodies` store to match existing storage convention)
   - Events to `rrwebEvents`
   - Screenshots to `screenshots`
   - Bundles to `correlationBundles`

6. **Auto-select:** After successful write, set the imported session as the active session in the replay store.

### Error Handling

All errors displayed as a toast/banner in the replay UI:

| Condition               | Message                                                     |
| ----------------------- | ----------------------------------------------------------- |
| Invalid gzip            | "This file doesn't appear to be a valid .underpixel export" |
| JSON parse failure      | "This file doesn't appear to be a valid .underpixel export" |
| Version mismatch        | "This file was exported with a newer version of UnderPixel" |
| Missing required fields | "This file is missing required session data"                |
| IDB write failure       | "Import failed — not enough storage space"                  |

## Data Model Changes

### Modified: `CaptureSession` (in `packages/shared/src/types.ts`)

Three optional fields added:

```typescript
imported?: boolean;              // true for imported sessions
importedAt?: number;             // Epoch ms of import time
originalSessionId?: string;      // Session ID before re-keying
```

All optional — existing sessions unaffected. No IDB schema version bump or migration needed.

### New Types (in `packages/shared/src/types.ts`)

- `UnderpixelBundle` — top-level export format
- `ExportOptions` — export configuration

## File Organization

### New Files

| File                                                 | Purpose                                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------ |
| `extension/src/replay/lib/export.ts`                 | Export logic: read IDB, apply options, compress, trigger download  |
| `extension/src/replay/lib/import.ts`                 | Import logic: decompress, validate, re-key, write to IDB           |
| `extension/src/replay/components/ExportModal.svelte` | Options modal with toggles for screenshots, bodies, header masking |

### Modified Files

| File                                                   | Change                                                                                                                  |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/types.ts`                         | Add `imported`, `importedAt`, `originalSessionId` to `CaptureSession`; add `UnderpixelBundle` and `ExportOptions` types |
| `extension/entrypoints/replay/App.svelte`              | Wire Export button click handler, add Import button, show import errors/toasts                                          |
| `extension/src/replay/components/SessionPicker.svelte` | Show "Imported" badge on imported sessions                                                                              |

### Unchanged

- IDB schema (`extension/lib/storage/db.ts`) — no new stores or indexes
- Bridge / MCP server — export/import is UI-only
- Background service worker — no involvement
- Popup UI — no changes

## Not In Scope

- **Drag-and-drop import** — deferred, file picker only for v1.
- **MCP export/import tools** — UI-only per design decision.
- **Streaming export** — not needed for typical session sizes (<50MB uncompressed).
- **Partial export** (date range, specific requests) — full session only for v1.
