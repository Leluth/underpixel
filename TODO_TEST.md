# Pending Manual Tests

## dom_text TreeWalker fix
- [ ] Test `underpixel_dom_text` with `body` selector on a JSON API page (e.g. `https://reqres.in/api/users`)
- [ ] Verify no "Value is unserializable" error
- [ ] Confirm JSON text content is returned correctly
- [ ] Test `body` selector on a normal HTML page (e.g. `https://example.com`) — should still work
- [ ] Test `div` selector on a content-heavy SPA — verify TreeWalker kicks in
- [ ] Test inline element selector (e.g. `span`, `a`) — should use fast textContent path
- [ ] Verify script/style content is excluded from results
