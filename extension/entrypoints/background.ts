// Static imports for modules used in hot-path listeners (onUpdated, onMessage)
import { isCapturing, getSessionId } from '../lib/network/capture';
import { db } from '../lib/storage/db';
import { enqueueRrwebEvent } from '../lib/recording/event-batcher';

export default defineBackground(() => {
  console.log('[UnderPixel] Background service worker started');

  // Register MAIN world content script for rrweb recording
  chrome.scripting
    .registerContentScripts([
      {
        id: 'underpixel-recorder',
        matches: ['<all_urls>'],
        js: ['content-recorder.js'],
        runAt: 'document_idle',
        world: 'MAIN',
      },
    ])
    .catch((err) => {
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

  // Recover capture state after service worker restart
  recoverCaptureState();

  // Clean up old sessions on startup
  import('../lib/storage/db').then(({ cleanupOldSessions }) => {
    cleanupOldSessions().then((count) => {
      if (count > 0) console.log(`[UnderPixel] Cleaned up ${count} old sessions`);
    });
  });

  // Re-start rrweb recording after page navigation on a capturing tab.
  // Uses chrome.tabs.onUpdated with status:'complete' instead of a fixed
  // setTimeout — fires when the page is actually ready, not after an
  // arbitrary delay.
  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
    if (changeInfo.status !== 'complete') return;

    if (!isCapturing(tabId)) return;

    const sessionId = getSessionId(tabId);
    if (!sessionId) return;

    const database = await db();
    const session = await database.get('sessions', sessionId);
    if (!session) return;

    console.log(`[UnderPixel] Tab ${tabId} loaded, restarting rrweb recording`);

    try {
      await chrome.tabs.sendMessage(tabId, {
        type: 'underpixel-command',
        action: 'start-recording',
        config: {
          sampling: session.config.rrwebSampling,
          maskInputs: session.config.maskInputs,
          maskTextSelector: session.config.maskTextSelector,
        },
      });
      console.log(`[UnderPixel] rrweb recording restarted on tab ${tabId}`);
    } catch (err) {
      console.warn(`[UnderPixel] Failed to restart rrweb after navigation:`, err);
    }
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
        (result) => sendResponse({ ok: true, ...result }),
        (err: Error) => sendResponse({ error: err.message }),
      );
      return true; // async response
    }

    return false;
  });
});

async function recoverCaptureState() {
  try {
    const state = await chrome.storage.local.get([
      'captureActive',
      'activeSessionId',
      'activeTabId',
    ]);

    if (!state.captureActive || !state.activeSessionId || !state.activeTabId) return;

    const tabId = state.activeTabId as number;
    const sessionId = state.activeSessionId as string;

    // Verify the tab still exists
    try {
      await chrome.tabs.get(tabId);
    } catch {
      // Tab is gone — mark session as stopped
      console.log('[UnderPixel] Recovery: tab gone, stopping session');
      const { db } = await import('../lib/storage/db');
      const database = await db();
      const session = await database.get('sessions', sessionId);
      if (session && session.status === 'active') {
        session.status = 'stopped';
        session.endTime = Date.now();
        await database.put('sessions', session);
      }
      await chrome.storage.local.set({
        captureActive: false,
        activeSessionId: null,
        activeTabId: null,
      });
      return;
    }

    // Re-attach debugger and resume network capture
    const { db } = await import('../lib/storage/db');
    const database = await db();
    const session = await database.get('sessions', sessionId);
    if (!session || session.status !== 'active') return;

    console.log(`[UnderPixel] Recovery: resuming capture on tab ${tabId}, session ${sessionId}`);
    const { startCapture } = await import('../lib/network/capture');
    await startCapture(tabId, sessionId, session.config);

    // Re-start rrweb recording in the tab
    try {
      await chrome.tabs.sendMessage(tabId, {
        type: 'underpixel-command',
        action: 'start-recording',
        config: {
          sampling: session.config.rrwebSampling,
          maskInputs: session.config.maskInputs,
          maskTextSelector: session.config.maskTextSelector,
        },
      });
    } catch {
      // Content script may not be ready yet
    }

    console.log('[UnderPixel] Recovery: capture resumed');
  } catch (err) {
    console.error('[UnderPixel] Recovery failed:', err);
    await chrome.storage.local.set({
      captureActive: false,
      activeSessionId: null,
      activeTabId: null,
    });
  }
}

async function handlePopupAction(action: string): Promise<Record<string, unknown>> {
  if (action === 'start-capture') {
    const { toolRegistry } = await import('../lib/tools/registry');
    await toolRegistry.execute('underpixel_capture_start', {});
  } else if (action === 'stop-capture') {
    const { toolRegistry } = await import('../lib/tools/registry');
    await toolRegistry.execute('underpixel_capture_stop', {});
  } else if (action === 'clear-all-data') {
    const { clearAllData } = await import('../lib/storage/db');
    await clearAllData();
  } else if (action === 'has-sessions') {
    const { getLatestSession } = await import('../lib/storage/db');
    const session = await getLatestSession();
    return { hasSessions: !!session };
  } else if (action === 'open-replay') {
    const { getLatestSession } = await import('../lib/storage/db');
    const session = await getLatestSession();
    if (session) {
      const url = chrome.runtime.getURL(`replay.html?sessionId=${session.id}`);
      await chrome.tabs.create({ url });
    }
  }
  return {};
}

async function handleContentMessage(
  message: { type: string; payload: unknown },
  sender: chrome.runtime.MessageSender,
) {
  const tabId = sender.tab?.id;
  if (!tabId) return;

  // Check if we're capturing this tab
  const sessionId = getSessionId(tabId);
  if (!sessionId) return;

  if (message.type === 'rrweb') {
    const payload = message.payload as {
      event: { type: number; data: unknown; timestamp: number };
      isCheckout?: boolean;
    };

    const stored = {
      sessionId,
      timestamp: payload.event.timestamp,
      type: payload.event.type,
      data: payload.event.data,
    };

    // Batched write: accumulates for 200ms, then bulk-puts to IndexedDB
    enqueueRrwebEvent(sessionId, stored);
  }
}
