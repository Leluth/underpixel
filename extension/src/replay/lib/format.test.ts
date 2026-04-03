import { describe, it, expect } from 'vitest';
import { formatDuration, formatTimestamp, shortenUrl } from './format';

describe('formatDuration', () => {
  it('formats milliseconds under 1s', () => {
    expect(formatDuration(245)).toBe('245ms');
  });
  it('formats seconds with one decimal', () => {
    expect(formatDuration(1200)).toBe('1.2s');
  });
  it('formats exact seconds without decimal', () => {
    expect(formatDuration(3000)).toBe('3.0s');
  });
  it('returns "—" for undefined', () => {
    expect(formatDuration(undefined)).toBe('—');
  });
});

describe('formatTimestamp', () => {
  it('formats ms offset as mm:ss.SSS', () => {
    expect(formatTimestamp(47200)).toBe('00:47.200');
  });
  it('formats over a minute', () => {
    expect(formatTimestamp(154000)).toBe('02:34.000');
  });
  it('formats zero', () => {
    expect(formatTimestamp(0)).toBe('00:00.000');
  });
});

describe('shortenUrl', () => {
  it('extracts pathname from full URL', () => {
    expect(shortenUrl('https://api.example.com/api/okrs')).toBe('/api/okrs');
  });
  it('keeps query params', () => {
    expect(shortenUrl('https://a.com/api/users?page=1')).toBe('/api/users?page=1');
  });
  it('returns as-is if not a valid URL', () => {
    expect(shortenUrl('/api/okrs')).toBe('/api/okrs');
  });
});
