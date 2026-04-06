import { describe, it, expect } from 'vitest';
import {
  NATIVE_HOST_NAME,
  DEFAULT_PORT,
  MAX_RESPONSE_BODY_SIZE,
  INLINE_BODY_THRESHOLD,
  MAX_REQUESTS_PER_SESSION,
  TOOL_CALL_TIMEOUT,
  DEFAULT_EXCLUDED_DOMAINS,
  DEFAULT_CAPTURE_CONFIG,
  TOOL_NAMES,
} from './constants';

describe('constants', () => {
  it('NATIVE_HOST_NAME follows Chrome convention', () => {
    // Must be lowercase, dot-separated, no hyphens in segments
    expect(NATIVE_HOST_NAME).toBe('com.underpixel.bridge');
    expect(NATIVE_HOST_NAME).toMatch(/^[a-z]+(\.[a-z]+)+$/);
  });

  it('DEFAULT_PORT is a valid high port', () => {
    expect(DEFAULT_PORT).toBeGreaterThan(1024);
    expect(DEFAULT_PORT).toBeLessThan(65536);
  });

  it('body size thresholds are ordered correctly', () => {
    expect(INLINE_BODY_THRESHOLD).toBeLessThan(MAX_RESPONSE_BODY_SIZE);
    expect(INLINE_BODY_THRESHOLD).toBe(100 * 1024); // 100KB
    expect(MAX_RESPONSE_BODY_SIZE).toBe(1 * 1024 * 1024); // 1MB
  });

  it('request limit is reasonable', () => {
    expect(MAX_REQUESTS_PER_SESSION).toBe(500);
  });

  it('tool call timeout is 120s', () => {
    expect(TOOL_CALL_TIMEOUT).toBe(120_000);
  });

  it('excluded domains cover common analytics providers', () => {
    expect(DEFAULT_EXCLUDED_DOMAINS).toContain('google-analytics.com');
    expect(DEFAULT_EXCLUDED_DOMAINS).toContain('mixpanel.com');
    expect(DEFAULT_EXCLUDED_DOMAINS).toContain('sentry.io');
    expect(DEFAULT_EXCLUDED_DOMAINS).toContain('hotjar.com');
    expect(DEFAULT_EXCLUDED_DOMAINS.length).toBeGreaterThanOrEqual(10);
  });
});

describe('DEFAULT_CAPTURE_CONFIG', () => {
  it('has sensible defaults', () => {
    expect(DEFAULT_CAPTURE_CONFIG.includeStatic).toBe(false);
    expect(DEFAULT_CAPTURE_CONFIG.screenshotsEnabled).toBe(true);
    expect(DEFAULT_CAPTURE_CONFIG.correlationWindow).toBe(500);
    expect(DEFAULT_CAPTURE_CONFIG.pixelDiffThreshold).toBe(0.01);
    expect(DEFAULT_CAPTURE_CONFIG.maskInputs).toBe(false);
  });

  it('rrweb sampling is configured', () => {
    expect(DEFAULT_CAPTURE_CONFIG.rrwebSampling.mousemove).toBe(100);
    expect(DEFAULT_CAPTURE_CONFIG.rrwebSampling.scroll).toBe(150);
    expect(DEFAULT_CAPTURE_CONFIG.rrwebSampling.input).toBe('last');
  });

  it('excludeDomains references the shared list', () => {
    expect(DEFAULT_CAPTURE_CONFIG.excludeDomains).toBe(DEFAULT_EXCLUDED_DOMAINS);
  });
});

describe('TOOL_NAMES', () => {
  it('has 13 tools', () => {
    expect(Object.keys(TOOL_NAMES)).toHaveLength(13);
  });

  it('all values start with underpixel_', () => {
    for (const name of Object.values(TOOL_NAMES)) {
      expect(name.startsWith('underpixel_')).toBe(true);
    }
  });

  it('has expected categories', () => {
    // Core
    expect(TOOL_NAMES.CORRELATE).toBeDefined();
    expect(TOOL_NAMES.TIMELINE).toBeDefined();
    expect(TOOL_NAMES.SNAPSHOT_AT).toBeDefined();
    // Network
    expect(TOOL_NAMES.CAPTURE_START).toBeDefined();
    expect(TOOL_NAMES.CAPTURE_STOP).toBeDefined();
    expect(TOOL_NAMES.API_CALLS).toBeDefined();
    expect(TOOL_NAMES.API_DEPENDENCIES).toBeDefined();
    // Visual
    expect(TOOL_NAMES.SCREENSHOT).toBeDefined();
    expect(TOOL_NAMES.DOM_TEXT).toBeDefined();
    expect(TOOL_NAMES.REPLAY).toBeDefined();
    // Browser
    expect(TOOL_NAMES.NAVIGATE).toBeDefined();
    expect(TOOL_NAMES.INTERACT).toBeDefined();
    expect(TOOL_NAMES.PAGE_READ).toBeDefined();
  });
});
