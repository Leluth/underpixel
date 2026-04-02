import {
  NativeMessage,
  NativeMessageType,
  ToolCallPayload,
  NATIVE_HOST_NAME,
  DEFAULT_PORT,
} from 'underpixel-shared';
import { toolRegistry } from '../tools/registry';

let port: chrome.runtime.Port | null = null;
let serverPort: number | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 500;
const MAX_RECONNECT_DELAY = 30_000;

/** Connect to the native messaging host (bridge) */
export function connectNative(): void {
  if (port) return;

  try {
    port = chrome.runtime.connectNative(NATIVE_HOST_NAME);

    port.onMessage.addListener(handleMessage);
    port.onDisconnect.addListener(handleDisconnect);

    reconnectDelay = 500; // Reset on successful connection
    console.log('[UnderPixel] Connected to native host');

    // Tell the bridge to start its HTTP server
    sendToNative({
      type: NativeMessageType.START,
      payload: { port: DEFAULT_PORT },
    });
  } catch (err) {
    console.error('[UnderPixel] Failed to connect to native host:', err);
    scheduleReconnect();
  }
}

function handleMessage(message: NativeMessage) {
  // Tool call from MCP client via bridge
  if (message.type === NativeMessageType.CALL_TOOL && message.requestId) {
    const { name, args } = message.payload as ToolCallPayload;
    handleToolCall(message.requestId, name, args);
    return;
  }

  // Bridge confirms HTTP server started
  if (message.type === NativeMessageType.SERVER_STARTED) {
    const payload = message.payload as { port: number };
    serverPort = payload.port;
    chrome.storage.local.set({ serverPort: payload.port, connected: true });
    console.log(`[UnderPixel] Bridge server ready on port ${payload.port}`);
    return;
  }

  // Ping → respond with pong
  if (message.type === NativeMessageType.PING) {
    sendToNative({ type: NativeMessageType.PONG });
    return;
  }
}

async function handleToolCall(requestId: string, name: string, args: Record<string, unknown>) {
  try {
    const result = await toolRegistry.execute(name, args);
    sendToNative({
      responseToRequestId: requestId,
      payload: result,
    });
  } catch (err) {
    sendToNative({
      responseToRequestId: requestId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function handleDisconnect() {
  const lastError = chrome.runtime.lastError;
  console.warn('[UnderPixel] Native host disconnected:', lastError?.message);
  port = null;
  serverPort = null;
  chrome.storage.local.set({ connected: false, serverPort: null });
  scheduleReconnect();
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  console.log(`[UnderPixel] Reconnecting in ${reconnectDelay}ms...`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
    connectNative();
  }, reconnectDelay);
}

export function sendToNative(message: NativeMessage): void {
  if (!port) {
    console.warn('[UnderPixel] Cannot send — not connected to native host');
    return;
  }
  port.postMessage(message);
}

export function isConnected(): boolean {
  return port !== null;
}

export function getServerPort(): number | null {
  return serverPort;
}
