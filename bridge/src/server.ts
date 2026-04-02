import Fastify, { FastifyRequest, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import { appendFileSync } from 'node:fs';

const DEBUG = process.env.UNDERPIXEL_DEBUG === '1';
const LOG_FILE = (process.env.LOCALAPPDATA || '/tmp') + '/underpixel-bridge.log';

function log(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  console.error(line.trim());
  if (DEBUG) {
    try {
      appendFileSync(LOG_FILE, line);
    } catch {}
  }
}
import { Server as McpServerBase } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  isInitializeRequest,
} from '@modelcontextprotocol/sdk/types.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'node:crypto';
import { TOOL_SCHEMAS } from 'underpixel-shared';
import { NativeMessagingHost } from './native-host.js';

function createMcpServer(host: NativeMessagingHost): McpServerBase {
  const server = new McpServerBase(
    { name: 'underpixel', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_SCHEMAS.map((s) => ({
      name: s.name,
      description: s.description,
      inputSchema: s.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const result = await host.callTool(name, args || {});
      return {
        content: [
          {
            type: 'text' as const,
            text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text' as const, text: `Error: ${msg}` }],
        isError: true,
      };
    }
  });

  return server;
}

export async function createServer(host: NativeMessagingHost, port: number) {
  const app = Fastify({ logger: false });
  await app.register(cors, {
    origin: (_origin, cb) => cb(null, true),
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  });

  // Per-session MCP server instances (SDK requires one Protocol per transport)
  const transports = new Map<string, StreamableHTTPServerTransport>();

  // ---- Routes ----

  app.get('/ping', async (_req: FastifyRequest, reply: FastifyReply) => {
    reply.status(200).send({ status: 'ok', message: 'pong' });
  });

  // MCP POST — following mcp-chrome's exact pattern
  app.post('/mcp', async (request, reply) => {
    const method = (request.body as any)?.method;
    log(`[MCP] POST session=${request.headers['mcp-session-id'] || '(none)'} method=${method}`);
    const sessionId = request.headers['mcp-session-id'] as string | undefined;
    let transport = sessionId
      ? (transports.get(sessionId) as StreamableHTTPServerTransport | undefined)
      : undefined;

    if (transport) {
      // Existing session — reuse transport
    } else if (!sessionId && isInitializeRequest(request.body)) {
      // New session — create transport
      const newSessionId = randomUUID();
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => newSessionId,
        onsessioninitialized: (id) => {
          if (transport && id === newSessionId) {
            transports.set(id, transport);
          }
        },
      });
      transport.onclose = () => {
        if (transport?.sessionId) {
          transports.delete(transport.sessionId);
        }
      };
      // Fresh server per session — SDK requires separate Protocol per transport
      await createMcpServer(host).connect(transport);
    } else {
      reply.code(400).send({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Bad Request: No valid session or initialize request' },
        id: null,
      });
      return;
    }

    try {
      await transport.handleRequest(request.raw, reply.raw, request.body);
    } catch (error) {
      log(`[MCP] POST error: ${error}`);
      if (!reply.sent) {
        reply.code(500).send({ error: 'MCP request processing error' });
      }
    }
  });

  // MCP GET — SSE stream
  app.get('/mcp', async (request, reply) => {
    const sessionId = request.headers['mcp-session-id'] as string | undefined;
    const transport = sessionId
      ? (transports.get(sessionId) as StreamableHTTPServerTransport | undefined)
      : undefined;

    if (!transport) {
      reply.code(400).send({ error: 'No active session' });
      return;
    }

    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.flushHeaders();

    try {
      await transport.handleRequest(request.raw, reply.raw);
      if (!reply.sent) {
        reply.hijack();
      }
    } catch {
      if (!reply.raw.writableEnded) {
        reply.raw.end();
      }
    }
  });

  // MCP DELETE
  app.delete('/mcp', async (request, reply) => {
    const sessionId = request.headers['mcp-session-id'] as string | undefined;
    const transport = sessionId
      ? (transports.get(sessionId) as StreamableHTTPServerTransport | undefined)
      : undefined;

    if (!transport) {
      reply.code(400).send({ error: 'Invalid session' });
      return;
    }

    try {
      await transport.handleRequest(request.raw, reply.raw);
      if (!reply.sent) {
        reply.code(204).send();
      }
    } catch {
      if (!reply.sent) {
        reply.code(500).send({ error: 'Session deletion error' });
      }
    }
  });

  // ---- Start ----
  await app.listen({ port, host: '127.0.0.1' });
  log(`UnderPixel MCP server listening on http://127.0.0.1:${port}/mcp`);

  return app;
}
