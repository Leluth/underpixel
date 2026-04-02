import { NativeMessagingHost } from './native-host.js';
import { createServer } from './server.js';
import { NativeMessageType, DEFAULT_PORT } from 'underpixel-shared';
import type { NativeMessage, ServerStartPayload } from 'underpixel-shared';

const host = new NativeMessagingHost();

// Wait for the extension to send START with the desired port,
// OR auto-start after a timeout (in case extension connects later).
const port = parseInt(process.env.UNDERPIXEL_PORT || '', 10) || DEFAULT_PORT;

let serverStarted = false;

async function startServer(serverPort: number) {
  if (serverStarted) return;
  serverStarted = true;

  try {
    await createServer(host, serverPort);

    // Tell the extension the server is ready
    host.send({
      type: NativeMessageType.SERVER_STARTED,
      payload: { port: serverPort },
    });

    // Keepalive ping every 30s to prevent service worker suspension
    setInterval(() => host.sendPing(), 30_000);
  } catch (err) {
    console.error('Failed to start UnderPixel bridge:', err);
    process.exit(1);
  }
}

// Listen for START message from extension
host.onMessage((message: NativeMessage) => {
  if (message.type === NativeMessageType.START) {
    const payload = message.payload as ServerStartPayload | undefined;
    const requestedPort = payload?.port || port;
    startServer(requestedPort);
  }
});

// Auto-start after 2s if no START message received
// (handles the case where bridge is launched before extension connects)
setTimeout(() => {
  if (!serverStarted) {
    console.error('No START message received, auto-starting server...');
    startServer(port);
  }
}, 2000);

// Graceful shutdown
const shutdown = async () => {
  host.destroy();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
