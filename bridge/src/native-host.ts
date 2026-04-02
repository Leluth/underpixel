import { NativeMessage, NativeMessageType, ToolCallPayload, TOOL_CALL_TIMEOUT } from 'underpixel-shared';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

/**
 * Native Messaging host — speaks length-prefixed JSON over stdin/stdout
 * to communicate with the Chrome extension.
 */
export class NativeMessagingHost {
  private pending = new Map<string, PendingRequest>();
  private buffer = Buffer.alloc(0);
  private onToolCallHandler?: (name: string, args: Record<string, unknown>) => Promise<unknown>;

  constructor() {
    // stdin must be in raw binary mode
    if (process.stdin.isTTY) {
      process.stdin.setRawMode?.(true);
    }
    process.stdin.resume();
    process.stdin.on('data', (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.processBuffer();
    });

    process.stdin.on('end', () => {
      process.exit(0);
    });
  }

  private processBuffer() {
    while (this.buffer.length >= 4) {
      const messageLength = this.buffer.readUInt32LE(0);
      if (messageLength > 10 * 1024 * 1024) {
        // Sanity check: >10MB message is probably corrupt
        console.error('Native host: message too large, resetting buffer');
        this.buffer = Buffer.alloc(0);
        return;
      }
      if (this.buffer.length < 4 + messageLength) {
        break; // Wait for more data
      }

      const messageJson = this.buffer.subarray(4, 4 + messageLength).toString('utf-8');
      this.buffer = this.buffer.subarray(4 + messageLength);

      try {
        const message: NativeMessage = JSON.parse(messageJson);
        this.handleMessage(message);
      } catch (e) {
        console.error('Native host: failed to parse message', e);
      }
    }
  }

  private handleMessage(message: NativeMessage) {
    // Response to a pending request
    if (message.responseToRequestId) {
      const pending = this.pending.get(message.responseToRequestId);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pending.delete(message.responseToRequestId);
        if (message.error) {
          pending.reject(new Error(message.error));
        } else {
          pending.resolve(message.payload);
        }
      }
      return;
    }

    // Extension-initiated messages
    switch (message.type) {
      case NativeMessageType.PONG:
        // Keepalive response, ignore
        break;
      default:
        // Unknown message type from extension
        break;
    }
  }

  /** Send a message to the extension via stdout */
  send(message: NativeMessage): void {
    const json = JSON.stringify(message);
    const buf = Buffer.from(json, 'utf-8');
    const header = Buffer.alloc(4);
    header.writeUInt32LE(buf.length, 0);
    process.stdout.write(Buffer.concat([header, buf]));
  }

  /** Send a tool call to the extension and wait for the response */
  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const requestId = crypto.randomUUID();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Tool call '${name}' timed out after ${TOOL_CALL_TIMEOUT / 1000}s`));
      }, TOOL_CALL_TIMEOUT);

      this.pending.set(requestId, { resolve, reject, timeout });

      this.send({
        type: NativeMessageType.CALL_TOOL,
        requestId,
        payload: { name, args } satisfies ToolCallPayload,
      });
    });
  }

  /** Request the extension to start the MCP session */
  sendStart(port: number): void {
    this.send({
      type: NativeMessageType.START,
      payload: { port },
    });
  }

  /** Send keepalive ping */
  sendPing(): void {
    this.send({ type: NativeMessageType.PING });
  }

  /** Clean up all pending requests */
  destroy(): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Native host destroyed'));
    }
    this.pending.clear();
  }
}
