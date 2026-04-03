<script lang="ts">
  import { replayStore, setSearch, setFilters } from '../stores/replay-store';
  import { colors } from '../lib/theme';

  const statusOptions = [
    { label: '2xx', color: colors.success },
    { label: '3xx', color: colors.warning },
    { label: '4xx/5xx', color: colors.error },
  ] as const;
  const methodOptions = ['GET', 'POST', 'PUT', 'DELETE'] as const;

  let searchInput = '';
  let debounceTimer: ReturnType<typeof setTimeout>;

  function handleSearchInput(e: Event) {
    const value = (e.target as HTMLInputElement).value;
    searchInput = value;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => setSearch(value), 200);
  }

  function toggleStatus(range: string) {
    const current = $replayStore.filters.statusRanges;
    const ranges = range === '4xx/5xx' ? ['4xx', '5xx'] : [range];

    const allPresent = ranges.every((r) => current.includes(r));
    const updated = allPresent
      ? current.filter((r) => !ranges.includes(r))
      : [...current.filter((r) => !ranges.includes(r)), ...ranges];

    setFilters({ ...$replayStore.filters, statusRanges: updated });
  }

  function toggleMethod(method: string) {
    const current = $replayStore.filters.methods;
    const updated = current.includes(method)
      ? current.filter((m) => m !== method)
      : [...current, method];
    setFilters({ ...$replayStore.filters, methods: updated });
  }

  function isStatusActive(label: string): boolean {
    const ranges = label === '4xx/5xx' ? ['4xx', '5xx'] : [label];
    return ranges.some((r) => $replayStore.filters.statusRanges.includes(r));
  }

  function isMethodActive(method: string): boolean {
    return $replayStore.filters.methods.includes(method);
  }
</script>

<div class="search-bar">
  <input
    type="search"
    placeholder="Search URLs, headers, bodies..."
    value={searchInput}
    on:input={handleSearchInput}
  />
  <div class="chips">
    {#each statusOptions as opt}
      <button
        class="chip"
        class:active={isStatusActive(opt.label)}
        style={isStatusActive(opt.label) ? `border-color: ${opt.color}; color: ${opt.color};` : ''}
        on:click={() => toggleStatus(opt.label)}
      >
        {opt.label}
      </button>
    {/each}
    {#each methodOptions as method}
      <button
        class="chip"
        class:active={isMethodActive(method)}
        on:click={() => toggleMethod(method)}
      >
        {method}
      </button>
    {/each}
  </div>
</div>

<style>
  .search-bar {
    padding: 8px;
    border-bottom: var(--border-width) solid var(--border);
  }

  input[type='search'] {
    width: 100%;
    box-sizing: border-box;
  }

  .chips {
    display: flex;
    gap: 4px;
    margin-top: 6px;
    flex-wrap: wrap;
  }

  .chip {
    font-size: 9px;
    padding: 2px 8px;
    border: 2px solid var(--border);
    background: var(--deep-bg);
    color: var(--text-dim);
    transition: all 0.15s;
  }

  .chip.active {
    color: var(--text-primary);
    background: var(--surface-active);
    border-color: var(--accent);
  }

  .chip:hover {
    background: var(--surface);
    color: var(--text-secondary);
  }
</style>
