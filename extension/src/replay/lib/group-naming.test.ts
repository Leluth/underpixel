import { describe, it, expect } from 'vitest';
import {
  generateGroupName,
  generateGroupSymbol,
  formatGroupTimestamp,
  formatGroupLabel,
} from './group-naming';

describe('generateGroupName', () => {
  it('returns PAGE LOAD for navigation trigger', () => {
    expect(generateGroupName('navigation')).toBe('PAGE LOAD');
  });
  it('extracts name from engine trigger format (METHOD /path)', () => {
    expect(generateGroupName('GET /api/metrics')).toBe('METRICS');
  });
  it('extracts name from nested path', () => {
    expect(generateGroupName('POST /api/v2/user/profile')).toBe('PROFILE');
  });
  it('strips /api/ prefix', () => {
    expect(generateGroupName('GET /api/users')).toBe('USERS');
  });
  it('returns USER ACTION for interaction triggers', () => {
    expect(generateGroupName('click')).toBe('USER ACTION');
  });
  it('returns PAGE UPDATE for empty trigger', () => {
    expect(generateGroupName('')).toBe('PAGE UPDATE');
  });
  it('returns PAGE UPDATE for unrecognized trigger', () => {
    expect(generateGroupName('something unknown')).toBe('PAGE UPDATE');
  });
});

describe('generateGroupSymbol', () => {
  it('returns star for page load', () => {
    expect(generateGroupSymbol('PAGE LOAD')).toBe('★');
  });
  it('returns heart for correlation groups', () => {
    expect(generateGroupSymbol('METRICS')).toBe('♥');
  });
  it('returns heart for page update fallback', () => {
    expect(generateGroupSymbol('PAGE UPDATE')).toBe('♥');
  });
});

describe('formatGroupTimestamp', () => {
  it('formats 0ms offset as 0:00', () => {
    expect(formatGroupTimestamp(0)).toBe('0:00');
  });
  it('formats seconds', () => {
    expect(formatGroupTimestamp(1500)).toBe('0:01');
  });
  it('formats minutes and seconds', () => {
    expect(formatGroupTimestamp(65000)).toBe('1:05');
  });
  it('formats large offsets', () => {
    expect(formatGroupTimestamp(754000)).toBe('12:34');
  });
  it('clamps negative offsets to 0:00', () => {
    expect(formatGroupTimestamp(-500)).toBe('0:00');
  });
});

describe('formatGroupLabel', () => {
  it('appends timestamp suffix to name', () => {
    expect(formatGroupLabel('USERS', 1500, 0)).toBe('USERS (0:01)');
  });
  it('computes offset from session start', () => {
    expect(formatGroupLabel('LOGIN', 1000065000, 1000000000)).toBe('LOGIN (1:05)');
  });
  it('handles zero session start', () => {
    expect(formatGroupLabel('PROFILE', 12000, 0)).toBe('PROFILE (0:12)');
  });
});
