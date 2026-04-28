# Pending Manual Tests

## Replay UI (Phase 2)

- [x] Replay page loads with Cozy Pixel RPG theme
- [x] Session picker shows captured sessions
- [x] rrweb-player renders recorded DOM
- [x] API timeline shows calls grouped by correlation (or OTHER CALLS)
- [x] Play/pause button works after clicking API calls or progress bar
- [x] Capture survives page navigation (rrweb restarts on new page)
- [x] Detail panel opens via ⓘ button, shows headers/request/response/timing/correlation tabs
- [x] Binary response bodies show "Binary data (N bytes)" not garbled text
- [x] NOW badge highlights the group containing the selected API call
- [x] Active group has gold border
- [x] Filter chips have clear active/inactive states
- [x] Clear All Data hides View Replay button
- [ ] Playback with timeline auto-scroll (only during play, not manual clicks) — code implemented, needs manual browser test
- [ ] Search bar filters API calls by URL/header/body text — code implemented, needs manual browser test
- [ ] Progress bar click seeks to correct position — code implemented, needs manual browser test
- [ ] Speed control (1x/2x/4x) changes playback speed — code implemented, needs manual browser test
- [ ] Session picker switches between sessions — code implemented, needs manual browser test
- [ ] Replay across multi-page navigation sessions (both pages visible in replay) — code implemented, needs manual browser test
- [ ] Copy cURL / Copy JSON in detail panel — code implemented, needs manual browser test
- [ ] ESC closes detail panel — code implemented, needs manual browser test

## Smart Screenshot Gate (Phase 2)

- [ ] Start capture on a page with dynamic content — verify auto-screenshots are stored in IDB
- [ ] Check stored screenshots have correct `width` and `height` (not 0)
- [ ] Navigate to a new page during capture — verify navigation screenshot is captured immediately
- [ ] Verify screenshot count in session stats after capture stop
- [ ] Change screenshot settings in popup (max, interval, threshold) — verify they persist across popup reopens
- [ ] Verify screenshot settings inputs are disabled while capture is active
- [ ] Start capture with screenshotsEnabled=false via MCP tool — verify no screenshots are taken
- [ ] Start capture with custom `screenshotConfig.diffThreshold` via MCP — verify it overrides popup default
- [ ] Verify offscreen document is created on capture start and closed on capture stop
- [ ] On a mostly-static page, verify screenshots are NOT saved when pixel diff is below threshold
- [ ] On a page with frequent small changes, verify max-per-session cap is respected

## dom_text TreeWalker fix

- [ ] Test `underpixel_dom_text` with `body` selector on a JSON API page (e.g. `https://reqres.in/api/users`)
- [ ] Verify no "Value is unserializable" error
- [ ] Confirm JSON text content is returned correctly
- [ ] Test `body` selector on a normal HTML page (e.g. `https://example.com`) — should still work
- [ ] Test `div` selector on a content-heavy SPA — verify TreeWalker kicks in
- [ ] Test inline element selector (e.g. `span`, `a`) — should use fast textContent path
- [ ] Verify script/style content is excluded from results

## correlate reverse path (DOM element → API tracing)

- [ ] Start capture on a page with a data table (e.g. `https://reqres.in`)
- [ ] Click around to trigger API calls that populate the table
- [ ] Stop capture
- [ ] `correlate("#users-list")` — verify `domMatches` is non-empty, matched by `id`
- [ ] `correlate(".user-card")` — verify class-based matching works
- [ ] `correlate("user table")` — verify free-text matching finds elements with nested text
- [ ] `correlate('[data-testid="users"]')` — verify attribute matching works
- [ ] Verify `confidence: 'high'` when both forward + reverse paths agree
- [ ] Verify `confidence: 'forward-only'` when only API body text matches
- [ ] Verify `confidence: 'reverse-only'` when only DOM element matches
- [ ] Verify `matchedIn: 'dom-reverse'` on API calls found only by reverse path
- [ ] Test with empty query — should return empty results, not crash
- [ ] Test with `#` alone — should return empty results
- [ ] Test with no capture session — should throw "No capture sessions found"

## attribute-value search (new in correlate)

- [ ] `correlate("cdn.example.com/photo.jpg")` on a page with `<img src="...cdn.example.com/photo.jpg">` — verify match via `src` attribute
- [ ] `correlate("placeholder text")` on a page with `<input placeholder="placeholder text">` — verify match
- [ ] Verify `data-*` attribute values are also searched during free-text queries

## value-level correlation (DOM text → API JSON field)

- [ ] Start capture on a page that loads data from an API (e.g. product names)
- [ ] Stop capture
- [ ] `correlate("product")` — verify `valueCorrelations` array is present in response
- [ ] Verify `valueCorrelations` entries include `domValue`, `apiUrl`, `jsonPath` (e.g. `items[0].name`)
- [ ] Verify value correlations only extract from matched DOM subtrees (not entire page)
- [ ] Test with a page showing many short strings — verify no noise from 1-3 char values

## Session Export/Import (Phase 3)

### Export

- [ ] Export button is disabled when no session is loaded
- [ ] Export button opens options modal with three toggles (screenshots, bodies, headers)
- [ ] Toggling "Mask sensitive headers" reveals editable header name list
- [ ] Clicking Export in modal triggers file download with `.underpixel` extension
- [ ] Exported filename matches `{title}-{date}.underpixel` format
- [ ] Export with all options default — verify file can be re-imported successfully
- [ ] Export with "Include screenshots" off — verify imported session has 0 screenshots
- [ ] Export with "Include response bodies" off — verify imported requests have no bodies
- [ ] Export with "Mask sensitive headers" on — verify authorization/cookie values are `[MASKED]` in imported data
- [ ] Export button shows "Exporting..." and is disabled during export
- [ ] Cancel button / Escape key closes modal without exporting
- [ ] Success toast appears after export completes

### Import

- [ ] Import button opens native file picker filtered to `.underpixel` files
- [ ] Importing a valid `.underpixel` file adds session to session picker
- [ ] Imported session auto-selects and loads in replay UI
- [ ] Imported session shows `[Imported]` badge and `▸` icon in session picker
- [ ] Imported session has a different ID than original (no collision)
- [ ] Imported session replays correctly (rrweb player, timeline, correlations)
- [ ] Importing a non-gzip file shows error toast: "doesn't appear to be a valid .underpixel export"
- [ ] Importing a corrupt JSON file shows error toast
- [ ] Importing a file with `version: 2` shows error: "exported with a newer version"
- [ ] Success toast appears after import completes
- [ ] Large response bodies (>100KB) are split back into `responseBodies` IDB store on import
