import { describe, it, expect } from 'vitest';
import { sanitizeFilename, applyExportOptions, DEFAULT_MASKED_HEADERS } from './export';
import type {
  NetworkRequest,
  StoredScreenshot,
  CorrelationBundle,
  ExportOptions,
} from 'underpixel-shared';

// -- Fixtures --

function makeRequest(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    requestId: 'req-1',
    sessionId: 'sess-1',
    url: 'https://api.example.com/data',
    method: 'GET',
    status: 'complete',
    statusCode: 200,
    type: 'fetch',
    startTime: 1000,
    endTime: 1200,
    requestHeaders: { authorization: 'Bearer secret', 'content-type': 'application/json' },
    responseHeaders: { 'set-cookie': 'sid=abc123', 'content-type': 'application/json' },
    responseBody: '{"ok":true}',
    ...overrides,
  };
}

function makeScreenshot(overrides: Partial<StoredScreenshot> = {}): StoredScreenshot {
  return {
    id: 'ss-1',
    sessionId: 'sess-1',
    timestamp: 1100,
    dataUrl: 'data:image/jpeg;base64,/9j/4AAQ...',
    width: 1920,
    height: 1080,
    trigger: 'api-response',
    ...overrides,
  };
}

function makeBundle(overrides: Partial<CorrelationBundle> = {}): CorrelationBundle {
  return {
    id: 'bun-1',
    sessionId: 'sess-1',
    timestamp: 1100,
    trigger: 'API: GET /data',
    apiCalls: ['req-1'],
    rrwebEventIds: [1, 2],
    screenshotId: 'ss-1',
    correlation: 'GET /data → 2 DOM mutations',
    ...overrides,
  };
}

// -- Tests --

describe('sanitizeFilename', () => {
  it('replaces non-alphanumeric chars with hyphens', () => {
    expect(sanitizeFilename('Hello World! @#$')).toBe('Hello-World');
  });

  it('collapses consecutive hyphens', () => {
    expect(sanitizeFilename('a---b___c')).toBe('a-b-c');
  });

  it('trims to 60 characters', () => {
    const long = 'A'.repeat(100);
    expect(sanitizeFilename(long).length).toBeLessThanOrEqual(60);
  });

  it('strips leading/trailing hyphens', () => {
    expect(sanitizeFilename('--hello--')).toBe('hello');
  });

  it('returns empty string for empty input', () => {
    expect(sanitizeFilename('')).toBe('');
  });
});

describe('applyExportOptions', () => {
  const defaultOptions: ExportOptions = {
    includeScreenshots: true,
    includeResponseBodies: true,
    maskSensitiveHeaders: false,
    maskedHeaderNames: DEFAULT_MASKED_HEADERS,
  };

  it('returns data unchanged with default options', () => {
    const requests = [makeRequest()];
    const screenshots = [makeScreenshot()];
    const bundles = [makeBundle()];
    const result = applyExportOptions(requests, screenshots, bundles, defaultOptions);

    expect(result.requests[0].responseBody).toBe('{"ok":true}');
    expect(result.screenshots).toHaveLength(1);
    expect(result.requests[0].requestHeaders!.authorization).toBe('Bearer secret');
  });

  it('strips screenshots when includeScreenshots is false', () => {
    const options = { ...defaultOptions, includeScreenshots: false };
    const result = applyExportOptions([makeRequest()], [makeScreenshot()], [makeBundle()], options);

    expect(result.screenshots).toHaveLength(0);
    expect(result.bundles[0].screenshotId).toBeUndefined();
  });

  it('strips response bodies when includeResponseBodies is false', () => {
    const options = { ...defaultOptions, includeResponseBodies: false };
    const result = applyExportOptions([makeRequest()], [makeScreenshot()], [makeBundle()], options);

    expect(result.requests[0].responseBody).toBeUndefined();
  });

  it('masks sensitive headers when maskSensitiveHeaders is true', () => {
    const options = { ...defaultOptions, maskSensitiveHeaders: true };
    const result = applyExportOptions([makeRequest()], [makeScreenshot()], [makeBundle()], options);

    expect(result.requests[0].requestHeaders!.authorization).toBe('[MASKED]');
    expect(result.requests[0].responseHeaders!['set-cookie']).toBe('[MASKED]');
    // Non-sensitive headers untouched
    expect(result.requests[0].requestHeaders!['content-type']).toBe('application/json');
  });

  it('uses custom maskedHeaderNames', () => {
    const options = {
      ...defaultOptions,
      maskSensitiveHeaders: true,
      maskedHeaderNames: ['content-type'],
    };
    const result = applyExportOptions([makeRequest()], [makeScreenshot()], [makeBundle()], options);

    expect(result.requests[0].requestHeaders!['content-type']).toBe('[MASKED]');
    // authorization NOT masked since it's not in custom list
    expect(result.requests[0].requestHeaders!.authorization).toBe('Bearer secret');
  });

  it('handles requests with no headers when masking is enabled', () => {
    const options = { ...defaultOptions, maskSensitiveHeaders: true };
    const request = makeRequest({ requestHeaders: undefined, responseHeaders: undefined });
    const result = applyExportOptions([request], [makeScreenshot()], [makeBundle()], options);

    expect(result.requests[0].requestHeaders).toBeUndefined();
    expect(result.requests[0].responseHeaders).toBeUndefined();
  });

  it('applies all options simultaneously', () => {
    const options: ExportOptions = {
      includeScreenshots: false,
      includeResponseBodies: false,
      maskSensitiveHeaders: true,
      maskedHeaderNames: DEFAULT_MASKED_HEADERS,
    };
    const result = applyExportOptions([makeRequest()], [makeScreenshot()], [makeBundle()], options);

    expect(result.screenshots).toHaveLength(0);
    expect(result.requests[0].responseBody).toBeUndefined();
    expect(result.requests[0].requestHeaders!.authorization).toBe('[MASKED]');
    expect(result.bundles[0].screenshotId).toBeUndefined();
  });

  it('does not mutate original arrays', () => {
    const requests = [makeRequest()];
    const screenshots = [makeScreenshot()];
    const bundles = [makeBundle()];
    const options = {
      ...defaultOptions,
      includeScreenshots: false,
      maskSensitiveHeaders: true,
    };

    applyExportOptions(requests, screenshots, bundles, options);

    // Originals unchanged
    expect(requests[0].requestHeaders!.authorization).toBe('Bearer secret');
    expect(screenshots).toHaveLength(1);
    expect(bundles[0].screenshotId).toBe('ss-1');
  });
});
