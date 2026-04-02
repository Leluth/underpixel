/**
 * stdio MCP transport — spawned directly by MCP clients that don't support HTTP.
 * Bridges stdio JSON-RPC to the local HTTP server.
 *
 * Usage in MCP config:
 * { "command": "npx", "args": ["-y", "underpixel-bridge", "start"] }
 *
 * Or if the HTTP server is already running:
 * { "command": "npx", "args": ["-y", "underpixel-bridge", "stdio"] }
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { TOOL_SCHEMAS, DEFAULT_PORT } from 'underpixel-shared';

export async function startStdioBridge(httpPort?: number): Promise<void> {
  const port = httpPort || parseInt(process.env.UNDERPIXEL_PORT || '', 10) || DEFAULT_PORT;
  const baseUrl = `http://127.0.0.1:${port}`;

  const server = new McpServer(
    { name: 'underpixel', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  // Register all tools — each proxies to the HTTP MCP server
  for (const schema of TOOL_SCHEMAS) {
    server.tool(
      schema.name,
      schema.description,
      schema.inputSchema.properties,
      async (params: Record<string, unknown>) => {
        try {
          // Call the HTTP server's tool endpoint
          const response = await fetch(`${baseUrl}/mcp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: crypto.randomUUID(),
              method: 'tools/call',
              params: { name: schema.name, arguments: params },
            }),
          });

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${await response.text()}`);
          }

          const result = await response.json() as { result?: { content: unknown[] }; error?: { message: string } };
          if (result.error) {
            return {
              content: [{ type: 'text' as const, text: `Error: ${result.error.message}` }],
              isError: true,
            };
          }

          return result.result || {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
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

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(`UnderPixel stdio bridge connected (proxying to ${baseUrl}/mcp)`);
}
