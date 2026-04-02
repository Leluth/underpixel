import { describe, it, expect } from 'vitest';
import { buildLeafMap, extractTrackableValues } from './json-utils';

describe('buildLeafMap', () => {
  it('indexes flat object leaf values to paths', () => {
    const obj = { name: 'Alice', age: 30 };
    const map = new Map<string, string[]>();
    buildLeafMap(obj, map);

    expect(map.get('Alice')).toEqual(['name']);
    expect(map.get('30')).toEqual(['age']);
  });

  it('indexes nested objects with dot-separated paths', () => {
    const obj = { user: { name: 'Bob', email: 'bob@test.com' } };
    const map = new Map<string, string[]>();
    buildLeafMap(obj, map);

    expect(map.get('Bob')).toEqual(['user.name']);
    expect(map.get('bob@test.com')).toEqual(['user.email']);
  });

  it('indexes arrays with bracket notation', () => {
    const obj = { items: ['apple', 'banana'] };
    const map = new Map<string, string[]>();
    buildLeafMap(obj, map);

    expect(map.get('apple')).toEqual(['items[0]']);
    expect(map.get('banana')).toEqual(['items[1]']);
  });

  it('handles deeply nested arrays of objects', () => {
    const obj = {
      data: [
        { id: 1, name: 'First' },
        { id: 2, name: 'Second' },
      ],
    };
    const map = new Map<string, string[]>();
    buildLeafMap(obj, map);

    expect(map.get('First')).toEqual(['data[0].name']);
    expect(map.get('2')).toEqual(['data[1].id']);
  });

  it('collects multiple paths for duplicate values', () => {
    const obj = { first: 'same', second: 'same', nested: { third: 'same' } };
    const map = new Map<string, string[]>();
    buildLeafMap(obj, map);

    expect(map.get('same')).toEqual(['first', 'second', 'nested.third']);
  });

  it('handles null and undefined gracefully', () => {
    const map = new Map<string, string[]>();
    buildLeafMap(null, map);
    buildLeafMap(undefined, map);
    expect(map.size).toBe(0);
  });

  it('handles booleans', () => {
    const obj = { active: true, deleted: false };
    const map = new Map<string, string[]>();
    buildLeafMap(obj, map);

    expect(map.get('true')).toEqual(['active']);
    expect(map.get('false')).toEqual(['deleted']);
  });
});

describe('extractTrackableValues', () => {
  it('extracts JWT tokens (eyJ prefix)', () => {
    const body = JSON.stringify({
      token:
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
    });
    const values = extractTrackableValues(body);
    expect(values.size).toBe(1);
    const [val, type] = [...values.entries()][0];
    expect(type).toBe('jwt');
    expect(val.startsWith('eyJ')).toBe(true);
  });

  it('extracts UUIDs', () => {
    const body = JSON.stringify({
      userId: '550e8400-e29b-41d4-a716-446655440000',
    });
    const values = extractTrackableValues(body);
    expect(values.get('550e8400-e29b-41d4-a716-446655440000')).toBe('uuid');
  });

  it('extracts hex hash tokens (SHA-256 etc)', () => {
    const hash = 'a'.repeat(64); // 64 hex chars like SHA-256
    const body = JSON.stringify({ hash });
    const values = extractTrackableValues(body);
    expect(values.get(hash)).toBe('token');
  });

  it('extracts high-entropy tokens (32+ chars, alphanumeric with digits)', () => {
    const token = 'abc123def456ghi789jkl012mno345pqr';
    const body = JSON.stringify({ apiKey: token });
    const values = extractTrackableValues(body);
    expect(values.get(token)).toBe('token');
  });

  it('does NOT extract readable slugs as tokens', () => {
    const body = JSON.stringify({
      slug: 'firecrawl-claude-plugin-extension-v2-beta',
    });
    const values = extractTrackableValues(body);
    expect(values.size).toBe(0);
  });

  it('does NOT extract plain words as tokens', () => {
    const body = JSON.stringify({
      description: 'abcdefghijklmnopqrstuvwxyzabcdefgh', // 34 chars, no digits
    });
    const values = extractTrackableValues(body);
    expect(values.size).toBe(0);
  });

  it('extracts numeric IDs from fields ending in "id"', () => {
    const body = JSON.stringify({
      userId: 42,
      projectId: 100,
      name: 'test',
    });
    const values = extractTrackableValues(body);
    expect(values.get('42')).toBe('id');
    expect(values.get('100')).toBe('id');
  });

  it('does NOT extract numbers from non-id fields', () => {
    const body = JSON.stringify({
      count: 42,
      total: 100,
    });
    const values = extractTrackableValues(body);
    expect(values.size).toBe(0);
  });

  it('handles non-JSON body gracefully', () => {
    const values = extractTrackableValues('<html>Not JSON</html>');
    expect(values.size).toBe(0);
  });

  it('handles empty body', () => {
    const values = extractTrackableValues('');
    expect(values.size).toBe(0);
  });

  it('handles nested values', () => {
    const body = JSON.stringify({
      auth: {
        tokens: {
          access: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature',
          sessionId: '550e8400-e29b-41d4-a716-446655440000',
        },
      },
    });
    const values = extractTrackableValues(body);
    expect(values.size).toBe(2);
    const types = [...values.values()];
    expect(types).toContain('jwt');
    expect(types).toContain('uuid');
  });
});

describe('API dependency detection (value propagation)', () => {
  it('detects when response value appears in subsequent request', () => {
    const tokenValue = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.rg2LA';
    const authResponse = JSON.stringify({ token: tokenValue });

    const trackable = extractTrackableValues(authResponse);
    expect(trackable.has(tokenValue)).toBe(true);

    // Simulate: subsequent request uses this token in Authorization header
    const searchSpace = `Bearer ${tokenValue}`;
    const found = [...trackable.keys()].some((v) => searchSpace.includes(v));
    expect(found).toBe(true);
  });

  it('detects UUID propagation from response to request URL', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    const listResponse = JSON.stringify({ items: [{ id: uuid }] });

    const trackable = extractTrackableValues(listResponse);
    expect(trackable.has(uuid)).toBe(true);

    // Simulate: subsequent request uses this UUID in URL
    const url = `https://api.example.com/items/${uuid}`;
    const found = [...trackable.keys()].some((v) => url.includes(v));
    expect(found).toBe(true);
  });
});
