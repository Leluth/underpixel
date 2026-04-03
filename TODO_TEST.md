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
- [ ] Playback with timeline auto-scroll (only during play, not manual clicks)
- [ ] Search bar filters API calls by URL/header/body text
- [ ] Progress bar click seeks to correct position
- [ ] Speed control (1x/2x/4x) changes playback speed
- [ ] Session picker switches between sessions
- [ ] Replay across multi-page navigation sessions (both pages visible in replay)
- [ ] Copy cURL / Copy JSON in detail panel
- [ ] ESC closes detail panel

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
