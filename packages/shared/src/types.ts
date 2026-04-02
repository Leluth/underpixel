// ---- Native Messaging Protocol ----

export enum NativeMessageType {
  /** Extension tells bridge to start HTTP server */
  START = 'start',
  /** Bridge confirms server started */
  SERVER_STARTED = 'server_started',
  /** Extension tells bridge to stop */
  STOP = 'stop',
  /** Bridge confirms server stopped */
  SERVER_STOPPED = 'server_stopped',
  /** MCP tool call request (bridge → extension) */
  CALL_TOOL = 'call_tool',
  /** Ping for keepalive */
  PING = 'ping',
  /** Pong response */
  PONG = 'pong',
  /** Error from bridge */
  ERROR = 'error',
}

export interface NativeMessage<P = unknown> {
  type?: NativeMessageType;
  /** UUID for request/response pairing */
  requestId?: string;
  /** Matches a previous requestId */
  responseToRequestId?: string;
  payload?: P;
  error?: string;
}

export interface ToolCallPayload {
  name: string;
  args: Record<string, unknown>;
}

export interface ServerStartPayload {
  port: number;
}

// ---- Capture Types ----

export interface CaptureConfig {
  includeStatic: boolean;
  excludeDomains: string[];
  includeDomains?: string[];
  maxResponseBodySize: number;

  screenshotsEnabled: boolean;
  maxScreenshotsPerSession: number;
  screenshotInterval: number;
  pixelDiffThreshold: 'auto' | number;

  correlationWindow: number;

  rrwebSampling: {
    mousemove: number | false;
    scroll: number;
    input: 'last' | 'all';
  };
  maskInputs: boolean;
  maskTextSelector?: string;
}

export interface CaptureSession {
  id: string;
  startTime: number;
  endTime?: number;
  initialUrl: string;
  initialTitle: string;
  tabId: number;
  status: 'active' | 'stopped' | 'error';
  config: CaptureConfig;
  stats: {
    networkRequestCount: number;
    rrwebEventCount: number;
    screenshotCount: number;
    correlationBundleCount: number;
  };
}

export interface NetworkRequest {
  requestId: string;
  sessionId: string;
  url: string;
  method: string;
  status: 'pending' | 'complete' | 'error';
  statusCode?: number;
  type: string;
  mimeType?: string;

  requestHeaders?: Record<string, string>;
  requestBody?: string;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
  responseBodyRef?: string;

  startTime: number;
  endTime?: number;
  duration?: number;

  encodedDataLength?: number;
  errorText?: string;
}

export interface StoredRrwebEvent {
  sessionId: string;
  timestamp: number;
  type: number;
  data: unknown;
}

export type ScreenshotTrigger = 'manual' | 'dom-mutation' | 'navigation' | 'api-response';

export interface StoredScreenshot {
  id: string;
  sessionId: string;
  timestamp: number;
  dataUrl: string;
  width: number;
  height: number;
  trigger: ScreenshotTrigger;
  diffPercent?: number;
}

export interface CorrelationBundle {
  id: string;
  sessionId: string;
  timestamp: number;
  trigger: string;
  apiCalls: string[];
  rrwebEventIds: number[];
  screenshotId?: string;
  domMutationSummary?: {
    addedNodes: number;
    removedNodes: number;
    textChanges: number;
    attributeChanges: number;
  };
  correlation: string;
}

export interface DependencyEdge {
  from: { requestId: string; url: string; method: string };
  to: { requestId: string; url: string; method: string };
  via: string;
  valueType: 'jwt' | 'uuid' | 'url' | 'token' | 'id';
  location: 'url' | 'header' | 'body';
}
