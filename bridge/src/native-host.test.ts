import { describe, it, expect } from 'vitest';
import { NativeMessageType } from 'underpixel-shared';
import type { NativeMessage } from 'underpixel-shared';

// We can't easily instantiate NativeMessagingHost (binds to stdin/stdout),
// so we test the protocol encoding/decoding as pure functions.

/** Encode a NativeMessage the same way NativeMessagingHost.send() does */
function encodeMessage(message: NativeMessage): Buffer {
  const json = JSON.stringify(message);
  const buf = Buffer.from(json, 'utf-8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(buf.length, 0);
  return Buffer.concat([header, buf]);
}

/** Decode messages from a buffer (same as processBuffer logic) */
function decodeMessages(buffer: Buffer): { messages: NativeMessage[]; remaining: Buffer } {
  const messages: NativeMessage[] = [];
  let offset = 0;

  while (buffer.length - offset >= 4) {
    const messageLength = buffer.readUInt32LE(offset);
    if (messageLength > 10 * 1024 * 1024) {
      // Corrupt — same check as native-host.ts
      break;
    }
    if (buffer.length - offset < 4 + messageLength) {
      break; // Incomplete
    }

    const messageJson = buffer.subarray(offset + 4, offset + 4 + messageLength).toString('utf-8');
    messages.push(JSON.parse(messageJson));
    offset += 4 + messageLength;
  }

  return { messages, remaining: buffer.subarray(offset) };
}

describe('Native Messaging Protocol', () => {
  describe('encodeMessage', () => {
    it('encodes message with 4-byte LE length prefix', () => {
      const msg: NativeMessage = { type: NativeMessageType.PING };
      const encoded = encodeMessage(msg);

      // First 4 bytes = length of JSON payload
      const payloadLength = encoded.readUInt32LE(0);
      const payload = encoded.subarray(4).toString('utf-8');
      expect(payload).toBe(JSON.stringify(msg));
      expect(payloadLength).toBe(Buffer.byteLength(payload, 'utf-8'));
    });

    it('handles messages with complex payloads', () => {
      const msg: NativeMessage = {
        type: NativeMessageType.CALL_TOOL,
        requestId: '550e8400-e29b-41d4-a716-446655440000',
        payload: {
          name: 'underpixel_correlate',
          args: { query: 'user table', sessionId: 'abc-123' },
        },
      };
      const encoded = encodeMessage(msg);
      const decoded = decodeMessages(encoded);
      expect(decoded.messages).toHaveLength(1);
      expect(decoded.messages[0]).toEqual(msg);
    });

    it('handles messages with unicode content', () => {
      const msg: NativeMessage = {
        type: NativeMessageType.CALL_TOOL,
        payload: { name: 'test', args: { text: '日本語テスト 🎮' } },
      };
      const encoded = encodeMessage(msg);
      const decoded = decodeMessages(encoded);
      expect(decoded.messages).toHaveLength(1);
      expect((decoded.messages[0].payload as any).args.text).toBe('日本語テスト 🎮');
    });
  });

  describe('decodeMessages', () => {
    it('decodes a single complete message', () => {
      const msg: NativeMessage = { type: NativeMessageType.PONG };
      const encoded = encodeMessage(msg);
      const { messages, remaining } = decodeMessages(encoded);

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual(msg);
      expect(remaining.length).toBe(0);
    });

    it('decodes multiple concatenated messages', () => {
      const msg1: NativeMessage = { type: NativeMessageType.PING };
      const msg2: NativeMessage = { type: NativeMessageType.PONG };
      const msg3: NativeMessage = {
        type: NativeMessageType.START,
        payload: { port: 12307 },
      };
      const buffer = Buffer.concat([encodeMessage(msg1), encodeMessage(msg2), encodeMessage(msg3)]);

      const { messages, remaining } = decodeMessages(buffer);
      expect(messages).toHaveLength(3);
      expect(messages[0]).toEqual(msg1);
      expect(messages[1]).toEqual(msg2);
      expect(messages[2]).toEqual(msg3);
      expect(remaining.length).toBe(0);
    });

    it('handles partial messages (incomplete body)', () => {
      const msg: NativeMessage = { type: NativeMessageType.PING };
      const encoded = encodeMessage(msg);
      // Send only first 6 bytes (4-byte header + 2 bytes of body)
      const partial = encoded.subarray(0, 6);

      const { messages, remaining } = decodeMessages(partial);
      expect(messages).toHaveLength(0);
      expect(remaining.length).toBe(6);
    });

    it('handles partial header (< 4 bytes)', () => {
      const { messages, remaining } = decodeMessages(Buffer.from([0x05, 0x00]));
      expect(messages).toHaveLength(0);
      expect(remaining.length).toBe(2);
    });

    it('handles empty buffer', () => {
      const { messages, remaining } = decodeMessages(Buffer.alloc(0));
      expect(messages).toHaveLength(0);
      expect(remaining.length).toBe(0);
    });

    it('stops on corrupt message (>10MB length)', () => {
      const corrupt = Buffer.alloc(8);
      corrupt.writeUInt32LE(20 * 1024 * 1024, 0); // 20MB — corrupt
      const { messages } = decodeMessages(corrupt);
      expect(messages).toHaveLength(0);
    });

    it('decodes one complete + one partial correctly', () => {
      const msg1: NativeMessage = { type: NativeMessageType.PING };
      const msg2: NativeMessage = { type: NativeMessageType.PONG };
      const encoded1 = encodeMessage(msg1);
      const encoded2 = encodeMessage(msg2);
      // Complete first, partial second (only header + 1 byte)
      const partial = Buffer.concat([encoded1, encoded2.subarray(0, 5)]);

      const { messages, remaining } = decodeMessages(partial);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual(msg1);
      expect(remaining.length).toBe(5);
    });
  });

  describe('response matching', () => {
    it('response message matches by responseToRequestId', () => {
      const requestId = '550e8400-e29b-41d4-a716-446655440000';
      const response: NativeMessage = {
        responseToRequestId: requestId,
        payload: { result: 'success' },
      };

      expect(response.responseToRequestId).toBe(requestId);
      expect(response.error).toBeUndefined();
    });

    it('error response carries error string', () => {
      const response: NativeMessage = {
        responseToRequestId: 'req-1',
        error: 'Tool not found: underpixel_invalid',
      };

      expect(response.responseToRequestId).toBe('req-1');
      expect(response.error).toContain('Tool not found');
    });
  });
});
