import { describe, it, expect } from 'vitest';
import { generateGroupName, generateGroupSymbol } from './group-naming';

describe('generateGroupName', () => {
  it('returns PAGE LOAD for navigation trigger', () => {
    expect(generateGroupName('navigation')).toBe('PAGE LOAD');
  });
  it('extracts name from fetch response trigger', () => {
    expect(generateGroupName('fetch response: GET /api/metrics')).toBe('METRICS');
  });
  it('extracts name from fetch response with nested path', () => {
    expect(generateGroupName('fetch response: POST /api/v2/user/profile')).toBe('PROFILE');
  });
  it('falls back to USER ACTION for unknown triggers', () => {
    expect(generateGroupName('click')).toBe('USER ACTION');
  });
  it('falls back for empty trigger', () => {
    expect(generateGroupName('')).toBe('ACTIVITY');
  });
});

describe('generateGroupSymbol', () => {
  it('returns star for page load', () => {
    expect(generateGroupSymbol('PAGE LOAD')).toBe('★');
  });
  it('returns heart for active correlation', () => {
    expect(generateGroupSymbol('METRICS')).toBe('♥');
  });
  it('returns diamond for other', () => {
    expect(generateGroupSymbol('OTHER CALLS')).toBe('♦');
  });
});
