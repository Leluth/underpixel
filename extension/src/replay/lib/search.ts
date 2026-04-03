import type { NetworkRequest } from 'underpixel-shared';

export interface FilterState {
  methods: string[]; // e.g. ['GET', 'POST'] — empty = all
  statusRanges: string[]; // e.g. ['2xx', '4xx'] — empty = all
}

export const EMPTY_FILTERS: FilterState = { methods: [], statusRanges: [] };

function statusInRange(code: number | undefined, range: string): boolean {
  if (!code) return false;
  const base = parseInt(range.charAt(0), 10) * 100;
  return code >= base && code < base + 100;
}

/** Check if a request matches the active filter chips */
export function matchesFilters(req: NetworkRequest, filters: FilterState): boolean {
  if (filters.methods.length > 0) {
    if (!filters.methods.includes(req.method.toUpperCase())) return false;
  }
  if (filters.statusRanges.length > 0) {
    if (!filters.statusRanges.some((range) => statusInRange(req.statusCode, range))) return false;
  }
  return true;
}

/** Check if a request matches a free-text search query */
export function matchesSearch(req: NetworkRequest, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const searchable = [
    req.url,
    req.method,
    req.requestBody,
    req.responseBody,
    req.requestHeaders
      ? Object.entries(req.requestHeaders)
          .map(([k, v]) => `${k}: ${v}`)
          .join('\n')
      : '',
    req.responseHeaders
      ? Object.entries(req.responseHeaders)
          .map(([k, v]) => `${k}: ${v}`)
          .join('\n')
      : '',
  ]
    .join('\n')
    .toLowerCase();
  return searchable.includes(q);
}
