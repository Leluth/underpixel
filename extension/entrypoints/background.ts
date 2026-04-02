export default defineBackground(() => {
  console.log('[UnderPixel] Background service worker started');

  // Register MAIN world content script for rrweb recording
  chrome.scripting.registerContentScripts([{
    id: 'underpixel-recorder',
    matches: ['<all_urls>'],
    js: ['content-recorder.js'],
    runAt: 'document_idle',
    world: 'MAIN',
  }]).catch((err) => {
    // May already be registered from a previous load
    if (!String(err).includes('Duplicate script ID')) {
      console.error('[UnderPixel] Failed to register content-recorder:', err);
    }
  });

  // Import tool handlers (self-registering)
  import('../lib/tools/network');
  import('../lib/tools/browser');
  import('../lib/tools/core');

  // Connect to native messaging host (bridge)
  import('../lib/native/host').then(({ connectNative }) => {
    connectNative();
  });

  // Clean up old sessions on startup
  import('../lib/storage/db').then(({ cleanupOldSessions }) => {
    cleanupOldSessions().then((count) => {
      if (count > 0) console.log(`[UnderPixel] Cleaned up ${count} old sessions`);
    });
  });

  // Handle messages from content scripts and popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'rrweb' || message.type === 'layout-shift') {
      handleContentMessage(message, sender);
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === 'underpixel-popup-action') {
      handlePopupAction(message.action).then(
        () => sendResponse({ ok: true }),
        (err: Error) => sendResponse({ error: err.message }),
      );
      return true; // async response
    }

    return false;
  });
});

async function handlePopupAction(action: string) {
  const { toolRegistry } = await import('../lib/tools/registry');

  if (action === 'start-capture') {
    await toolRegistry.execute('underpixel_capture_start', {});
  } else if (action === 'stop-capture') {
    await toolRegistry.execute('underpixel_capture_stop', {});
  }
}

async function handleContentMessage(
  message: { type: string; payload: unknown },
  sender: chrome.runtime.MessageSender,
) {
  const tabId = sender.tab?.id;
  if (!tabId) return;

  // Check if we're capturing this tab
  const { getSessionId } = await import('../lib/network/capture');
  const sessionId = getSessionId(tabId);
  if (!sessionId) return;

  if (message.type === 'rrweb') {
    const payload = message.payload as {
      event: { type: number; data: unknown; timestamp: number };
      isCheckout?: boolean;
    };

    const { db } = await import('../lib/storage/db');
    const database = await db();

    const stored = {
      sessionId,
      timestamp: payload.event.timestamp,
      type: payload.event.type,
      data: payload.event.data,
    };

    await database.add('rrwebEvents', stored);

    // Update session stats
    const session = await database.get('sessions', sessionId);
    if (session) {
      session.stats.rrwebEventCount++;
      await database.put('sessions', session);
    }

    // Notify correlation engine
    const { correlationEngine } = await import('../lib/correlation/engine');
    correlationEngine.onDomMutation(sessionId, stored);
  }
}
