/**
 * stdio MCP transport — spawned directly by MCP clients that don't support HTTP.
 * Connects to the running bridge process via HTTP to proxy tool calls.
 *
 * Usage in MCP config:
 * { "command": "npx", "args": ["-y", "underpixel-bridge", "stdio"] }
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { TOOL_SCHEMAS, DEFAULT_PORT } from 'underpixel-shared';

export async function startStdioBridge(httpPort?: number): Promise<void> {
  const port = httpPort || parseInt(process.env.UNDERPIXEL_PORT || '', 10) || DEFAULT_PORT;
  const baseUrl = `http://127.0.0.1:${port}/mcp`;

  // Connect to the HTTP MCP server as a client
  const httpTransport = new StreamableHTTPClientTransport(new URL(baseUrl));
  const httpClient = new Client({ name: 'underpixel-stdio-bridge', version: '0.1.0' });
  await httpClient.connect(httpTransport);

  // Create a stdio MCP server that proxies tool calls to the HTTP client
  const server = new McpServer(
    { name: 'underpixel', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  for (const schema of TOOL_SCHEMAS) {
    server.tool(
      schema.name,
      schema.description,
      schema.inputSchema.properties,
      async (params: Record<string, unknown>) => {
        try {
          const result = await httpClient.callTool({
            name: schema.name,
            arguments: params,
          });
          return result as { content: Array<{ type: 'text'; text: string }> };
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

  console.error(`UnderPixel stdio bridge connected (proxying to ${baseUrl})`);
}
