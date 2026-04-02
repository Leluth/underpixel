import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { TOOL_SCHEMAS } from 'underpixel-shared';
import { NativeMessagingHost } from './native-host.js';

export async function createServer(host: NativeMessagingHost, port: number) {
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });

  // ---- MCP Server (low-level, supports raw JSON Schema) ----
  const mcpServer = new Server(
    { name: 'underpixel', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  // List tools — return raw JSON schemas directly
  mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_SCHEMAS.map((s) => ({
      name: s.name,
      description: s.description,
      inputSchema: s.inputSchema,
    })),
  }));

  // Call tool — proxy to extension via native messaging
  mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
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

  // Transport map for session management
  const transports = new Map<string, StreamableHTTPServerTransport>();

  // ---- Routes ----
  app.get('/ping', async () => ({ status: 'ok', message: 'pong' }));

  // Streamable HTTP MCP endpoint
  app.post('/mcp', async (request, reply) => {
    const sessionId = (request.headers['mcp-session-id'] as string) || undefined;

    let transport: StreamableHTTPServerTransport;
    if (sessionId && transports.has(sessionId)) {
      transport = transports.get(sessionId)!;
    } else {
      // Generate session ID upfront to avoid timing gaps
      const newId = crypto.randomUUID();
      transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => newId });
      transports.set(newId, transport);
      transport.onclose = () => transports.delete(newId);
      await mcpServer.connect(transport);
    }

    const body = request.body as Record<string, unknown>;
    await transport.handleRequest(body, request.raw, reply.raw);
  });

  // GET for SSE stream (Streamable HTTP spec)
  app.get('/mcp', async (request, reply) => {
    const sessionId = request.headers['mcp-session-id'] as string;
    const transport = sessionId ? transports.get(sessionId) : undefined;
    if (!transport) {
      reply.code(400).send({ error: 'No active session. Send an initialize request first.' });
      return;
    }
    await transport.handleRequest({}, request.raw, reply.raw);
  });

  // DELETE to close session
  app.delete('/mcp', async (request, reply) => {
    const sessionId = request.headers['mcp-session-id'] as string;
    const transport = sessionId ? transports.get(sessionId) : undefined;
    if (transport) {
      await transport.close();
      transports.delete(sessionId);
    }
    reply.code(200).send({ status: 'closed' });
  });

  // ---- Start ----
  await app.listen({ port, host: '127.0.0.1' });
  console.error(`UnderPixel MCP server listening on http://127.0.0.1:${port}/mcp`);

  return app;
}
