import { NativeMessagingHost } from './native-host.js';
import { createServer } from './server.js';
import { DEFAULT_PORT } from 'underpixel-shared';

const host = new NativeMessagingHost();

// Start the MCP HTTP server immediately
const port = parseInt(process.env.UNDERPIXEL_PORT || '', 10) || DEFAULT_PORT;

try {
  const server = await createServer(host, port);

  // Tell the extension the server is ready
  host.sendStart(port);

  // Keepalive ping every 30s to prevent service worker suspension
  const keepalive = setInterval(() => host.sendPing(), 30_000);

  // Graceful shutdown
  const shutdown = async () => {
    clearInterval(keepalive);
    host.destroy();
    await server.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
} catch (err) {
  console.error('Failed to start UnderPixel bridge:', err);
  process.exit(1);
}
