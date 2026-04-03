import { describe, it, expect } from 'vitest';
import { formatGroupTimestamp } from './group-naming';

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
