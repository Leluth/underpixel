/** Walk a JSON object once, indexing every leaf value → its JSON path(s). */
export function buildLeafMap(obj: unknown, out: Map<string, string[]>, path = ''): void {
  if (obj === null || obj === undefined) return;

  if (typeof obj === 'string') {
    const list = out.get(obj);
    if (list) list.push(path);
    else out.set(obj, [path]);
    return;
  }
  if (typeof obj === 'number' || typeof obj === 'boolean') {
    const s = String(obj);
    const list = out.get(s);
    if (list) list.push(path);
    else out.set(s, [path]);
    return;
  }
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      buildLeafMap(obj[i], out, `${path}[${i}]`);
    }
    return;
  }
  if (typeof obj === 'object') {
    for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
      buildLeafMap(val, out, path ? `${path}.${key}` : key);
    }
  }
}

/** Recursively walk a JSON value, calling cb for every node. */
export function walkJson(
  obj: unknown,
  cb: (key: string | number, value: unknown) => void,
  key: string | number = '',
): void {
  if (obj === null || obj === undefined) return;
  cb(key, obj);
  if (typeof obj === 'object') {
    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) walkJson(obj[i], cb, i);
    } else {
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        walkJson(v, cb, k);
      }
    }
  }
}

/**
 * Extract trackable values from a JSON response body.
 * Identifies JWTs, UUIDs, hex tokens, high-entropy strings, and numeric IDs.
 * Returns a Map of value → type ('jwt' | 'uuid' | 'token' | 'id').
 */
export function extractTrackableValues(body: string): Map<string, string> {
  const values = new Map<string, string>();
  try {
    const parsed = JSON.parse(body);
    walkJson(parsed, (key, value) => {
      if (typeof value === 'string') {
        // JWTs (base64url-encoded JSON, always start with eyJ)
        if (value.startsWith('eyJ') && value.length > 30) {
          values.set(value, 'jwt');
        }
        // UUIDs
        else if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
          values.set(value, 'uuid');
        }
        // Hex hashes (SHA-1, SHA-256, etc.)
        else if (/^[0-9a-f]{32,}$/i.test(value)) {
          values.set(value, 'token');
        }
        // High-entropy tokens: 32+ chars, no spaces/dashes/dots, mixed with digits
        // Excludes readable slugs like "firecrawl-claude-plugin"
        else if (
          value.length >= 32 &&
          /^[A-Za-z0-9+/=_]+$/.test(value) && // no dashes (excludes slugs)
          /\d/.test(value) // must contain at least one digit (excludes plain words)
        ) {
          values.set(value, 'token');
        }
      }
      // Numeric IDs from keys ending in "id" (e.g., userId, projectId)
      if (typeof value === 'number' && typeof key === 'string' && /id$/i.test(key)) {
        values.set(String(value), 'id');
      }
    });
  } catch {
    // Not JSON
  }
  return values;
}
