/** Native Messaging host identifier */
export const NATIVE_HOST_NAME = 'com.underpixel.bridge';

/** Chrome extension ID (set after first unpacked load, update for Web Store) */
export const EXTENSION_ID = 'ggbdbakcfbghlcnggcpipkhgiepbiijh';

/** Default HTTP server port for MCP */
export const DEFAULT_PORT = 12307;

/** Chrome Debugger Protocol version */
export const CDP_VERSION = '1.3';

/** Max response body size in bytes (1MB) */
export const MAX_RESPONSE_BODY_SIZE = 1 * 1024 * 1024;

/** Threshold for inline vs ref storage of response bodies (100KB) */
export const INLINE_BODY_THRESHOLD = 100 * 1024;

/** Max requests per capture session */
export const MAX_REQUESTS_PER_SESSION = 500;

/** Tool call timeout in ms */
export const TOOL_CALL_TIMEOUT = 120_000;

/** Default analytics/tracking domains to exclude from capture */
export const DEFAULT_EXCLUDED_DOMAINS = [
  'google-analytics.com',
  'googletagmanager.com',
  'analytics.google.com',
  'mixpanel.com',
  'segment.io',
  'segment.com',
  'hotjar.com',
  'fullstory.com',
  'sentry.io',
  'bugsnag.com',
  'newrelic.com',
  'datadoghq.com',
  'facebook.net',
  'doubleclick.net',
];

/** Default capture configuration */
export const DEFAULT_CAPTURE_CONFIG = {
  includeStatic: false,
  excludeDomains: DEFAULT_EXCLUDED_DOMAINS,
  maxResponseBodySize: MAX_RESPONSE_BODY_SIZE,

  screenshotsEnabled: true,
  maxScreenshotsPerSession: 100,
  screenshotInterval: 500,
  pixelDiffThreshold: 'auto' as const,

  correlationWindow: 500,

  rrwebSampling: {
    mousemove: 100 as number | false,
    scroll: 150,
    input: 'last' as const,
  },
  maskInputs: false,
};

/** Tool names */
export const TOOL_NAMES = {
  // Core
  CORRELATE: 'underpixel_correlate',
  TIMELINE: 'underpixel_timeline',
  SNAPSHOT_AT: 'underpixel_snapshot_at',
  // Network
  CAPTURE_START: 'underpixel_capture_start',
  CAPTURE_STOP: 'underpixel_capture_stop',
  API_CALLS: 'underpixel_api_calls',
  API_DEPENDENCIES: 'underpixel_api_dependencies',
  // Visual
  SCREENSHOT: 'underpixel_screenshot',
  DOM_TEXT: 'underpixel_dom_text',
  REPLAY: 'underpixel_replay',
  // Browser control
  NAVIGATE: 'underpixel_navigate',
  INTERACT: 'underpixel_interact',
  PAGE_READ: 'underpixel_page_read',
} as const;
