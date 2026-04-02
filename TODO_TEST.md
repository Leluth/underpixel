# Pending Manual Tests

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
