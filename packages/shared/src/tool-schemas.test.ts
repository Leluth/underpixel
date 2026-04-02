import { describe, it, expect } from 'vitest';
import { TOOL_SCHEMAS } from './tool-schemas';
import { TOOL_NAMES } from './constants';

describe('TOOL_SCHEMAS', () => {
  it('defines exactly 13 tools', () => {
    expect(TOOL_SCHEMAS).toHaveLength(13);
  });

  it('every schema has required MCP fields', () => {
    for (const schema of TOOL_SCHEMAS) {
      expect(schema).toHaveProperty('name');
      expect(schema).toHaveProperty('description');
      expect(schema).toHaveProperty('inputSchema');
      expect(typeof schema.name).toBe('string');
      expect(typeof schema.description).toBe('string');
      expect(schema.name.length).toBeGreaterThan(0);
      expect(schema.description.length).toBeGreaterThan(0);
    }
  });

  it('all tool names start with "underpixel_"', () => {
    for (const schema of TOOL_SCHEMAS) {
      expect(schema.name.startsWith('underpixel_')).toBe(true);
    }
  });

  it('all TOOL_NAMES constants have a matching schema', () => {
    const schemaNames = new Set(TOOL_SCHEMAS.map((s) => s.name));
    for (const [_key, name] of Object.entries(TOOL_NAMES)) {
      expect(schemaNames.has(name)).toBe(true);
    }
  });

  it('all schemas have a valid JSON Schema inputSchema', () => {
    for (const schema of TOOL_SCHEMAS) {
      const input = schema.inputSchema;
      expect(input).toHaveProperty('type', 'object');
      expect(input).toHaveProperty('properties');
      expect(typeof input.properties).toBe('object');
    }
  });

  it('no duplicate tool names', () => {
    const names = TOOL_SCHEMAS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('specific tools have expected required parameters', () => {
    const byName = new Map(TOOL_SCHEMAS.map((s) => [s.name, s]));

    // correlate requires query
    const correlate = byName.get('underpixel_correlate');
    expect(correlate?.inputSchema.required).toContain('query');

    // navigate requires url
    const navigate = byName.get('underpixel_navigate');
    expect(navigate?.inputSchema.required).toContain('url');

    // interact requires action
    const interact = byName.get('underpixel_interact');
    expect(interact?.inputSchema.required).toContain('action');

    // dom_text requires selector
    const domText = byName.get('underpixel_dom_text');
    expect(domText?.inputSchema.required).toContain('selector');

    // snapshot_at requires timestamp
    const snapshotAt = byName.get('underpixel_snapshot_at');
    expect(snapshotAt?.inputSchema.required).toContain('timestamp');
  });
});
