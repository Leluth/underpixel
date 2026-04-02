import Fastify from 'fastify';
import cors from '@fastify/cors';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { TOOL_SCHEMAS } from 'underpixel-shared';
import { NativeMessagingHost } from './native-host.js';

export async function createServer(host: NativeMessagingHost, port: number) {
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });

  // ---- MCP Server ----
  const mcpServer = new McpServer(
    { name: 'underpixel', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  // Register all tools as proxies to the extension
  for (const schema of TOOL_SCHEMAS) {
    mcpServer.tool(
      schema.name,
      schema.description,
      schema.inputSchema.properties,
      async (params: Record<string, unknown>) => {
        try {
          const result = await host.callTool(schema.name, params);
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
      },
    );
  }

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
      transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => crypto.randomUUID() });
      await mcpServer.connect(transport);

      // Store after connection (transport generates session ID)
      transport.onclose = () => {
        const sid = (transport as any).sessionId;
        if (sid) transports.delete(sid);
      };
    }

    const body = request.body as Record<string, unknown>;
    const res = await transport.handleRequest(body, request.raw, reply.raw);

    // Store transport by session ID for subsequent requests
    const newSessionId = reply.raw.getHeader('mcp-session-id') as string;
    if (newSessionId && !transports.has(newSessionId)) {
      transports.set(newSessionId, transport);
    }
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
