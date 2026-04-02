import { TOOL_NAMES } from './constants.js';

export interface ToolSchema {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const TOOL_SCHEMAS: ToolSchema[] = [
  // ──── Core ────
  {
    name: TOOL_NAMES.CORRELATE,
    description:
      'Find which API calls feed a specific UI element or content. ' +
      'Query can be a CSS selector (#user-table, .data-grid, [data-testid="users"]), ' +
      'text content ("user table"), or element description. ' +
      'Searches both API response bodies (forward) and rrweb DOM snapshots (reverse) ' +
      'for high-confidence results. Returns matched API calls with confidence scoring.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'CSS selector, text content, or element description',
        },
        sessionId: {
          type: 'string',
          description: 'Session ID (default: latest active session)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: TOOL_NAMES.TIMELINE,
    description:
      'Get a chronological timeline of snapshot bundles with correlated ' +
      'API calls + visual state changes. Returns correlation bundles ordered by timestamp.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        startTime: {
          type: 'number',
          description: 'Start timestamp (epoch ms)',
        },
        endTime: {
          type: 'number',
          description: 'End timestamp (epoch ms)',
        },
        limit: {
          type: 'number',
          description: 'Max bundles to return (default: 50)',
        },
      },
    },
  },
  {
    name: TOOL_NAMES.SNAPSHOT_AT,
    description:
      'Get the visual state + API calls + DOM state at a specific moment. ' +
      'Returns the closest screenshot, active API calls, and DOM snapshot.',
    inputSchema: {
      type: 'object',
      properties: {
        timestamp: {
          type: 'number',
          description: 'Target timestamp (epoch ms)',
        },
        sessionId: { type: 'string' },
      },
      required: ['timestamp'],
    },
  },

  // ──── Network ────
  {
    name: TOOL_NAMES.CAPTURE_START,
    description:
      'Start recording network traffic + DOM changes + visual state on the active tab. ' +
      'Records all XHR/fetch calls with full request/response details. ' +
      'Shows "Chrome is being controlled" banner while active.',
    inputSchema: {
      type: 'object',
      properties: {
        filter: {
          type: 'object',
          description: 'Network capture filter',
          properties: {
            includeStatic: {
              type: 'boolean',
              description: 'Include CSS/JS/images (default: false)',
            },
            excludeDomains: {
              type: 'array',
              items: { type: 'string' },
              description: 'Domains to exclude',
            },
            includeDomains: {
              type: 'array',
              items: { type: 'string' },
              description: 'Only capture these domains',
            },
          },
        },
        screenshotsEnabled: {
          type: 'boolean',
          description: 'Auto-capture screenshots (default: true)',
        },
        tabId: {
          type: 'number',
          description: 'Tab to capture (default: active tab)',
        },
      },
    },
  },
  {
    name: TOOL_NAMES.CAPTURE_STOP,
    description:
      'Stop capture and return a summary: API call count, correlation bundles found, ' +
      'screenshots taken, and session ID for further queries.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
      },
    },
  },
  {
    name: TOOL_NAMES.API_CALLS,
    description:
      'Query captured API calls. Returns method, URL, status, timing, ' +
      'and optionally request/response bodies. Supports filtering by URL pattern, ' +
      'method, status code.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        urlPattern: {
          type: 'string',
          description: 'Filter by URL substring or glob',
        },
        method: {
          type: 'string',
          description: 'Filter by HTTP method',
        },
        statusCode: {
          type: 'number',
          description: 'Filter by status code',
        },
        includeBody: {
          type: 'boolean',
          description:
            'Include request/response bodies (default: false, can be large)',
        },
        limit: {
          type: 'number',
          description: 'Max results (default: 50)',
        },
      },
    },
  },
  {
    name: TOOL_NAMES.API_DEPENDENCIES,
    description:
      'Auto-detect API call chains by tracking value propagation. ' +
      'Returns edge list showing how responses feed into subsequent requests ' +
      '(e.g., login token used in authorized API call).',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
      },
    },
  },

  // ──── Visual ────
  {
    name: TOOL_NAMES.SCREENSHOT,
    description:
      'Take an on-demand screenshot of the current viewport. ' +
      'Always works regardless of auto-screenshot settings or limits.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: { type: 'number' },
        fullPage: {
          type: 'boolean',
          description: 'Capture full page (default: false, viewport only)',
        },
        selector: {
          type: 'string',
          description: 'CSS selector to capture specific element',
        },
      },
    },
  },
  {
    name: TOOL_NAMES.DOM_TEXT,
    description:
      'Extract text content from elements matching a CSS selector. ' +
      'Quick way to read page content without a full screenshot.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector' },
        tabId: { type: 'number' },
      },
      required: ['selector'],
    },
  },
  {
    name: TOOL_NAMES.REPLAY,
    description:
      'Open the replay viewer in a new browser tab. Shows rrweb session replay ' +
      'with synchronized API timeline panel. Returns the replay tab URL.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
      },
    },
  },

  // ──── Browser Control ────
  {
    name: TOOL_NAMES.NAVIGATE,
    description: 'Navigate the active tab to a URL.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        tabId: { type: 'number' },
        newTab: {
          type: 'boolean',
          description: 'Open in new tab (default: false)',
        },
      },
      required: ['url'],
    },
  },
  {
    name: TOOL_NAMES.INTERACT,
    description: 'Perform a browser action: click, fill, scroll, or type.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['click', 'fill', 'scroll', 'type', 'press'],
          description: 'Action type',
        },
        selector: {
          type: 'string',
          description: 'CSS selector for target element',
        },
        value: {
          type: 'string',
          description: 'Value for fill/type actions',
        },
        key: {
          type: 'string',
          description: 'Key for press action (e.g., "Enter", "Tab")',
        },
        direction: {
          type: 'string',
          enum: ['up', 'down'],
          description: 'Scroll direction',
        },
        tabId: { type: 'number' },
      },
      required: ['action'],
    },
  },
  {
    name: TOOL_NAMES.PAGE_READ,
    description:
      'Get an accessibility tree of visible elements on the page. ' +
      'Returns element types, text content, and interactive element identifiers.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: { type: 'number' },
        filter: {
          type: 'string',
          enum: ['all', 'interactive'],
          description: 'Element filter (default: all)',
        },
      },
    },
  },
];
