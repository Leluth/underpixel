/**
 * Content script — ISOLATED world.
 * Bridges between the MAIN world recorder and the background service worker.
 */
export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    // Receive events from MAIN world (rrweb events, layout shifts)
    window.addEventListener('message', (e) => {
      if (e.source !== window) return;
      const data = e.data;
      if (!data || data.source !== 'underpixel-event') return;

      // Forward to background service worker
      chrome.runtime.sendMessage({
        type: data.type, // 'rrweb' | 'layout-shift'
        payload: data,
      }).catch(() => {
        // Extension context may be invalidated
      });
    });

    // Receive commands from background (start/stop recording)
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg.type === 'underpixel-command') {
        // Forward command to MAIN world
        window.postMessage(
          {
            source: 'underpixel-control',
            action: msg.action,
            config: msg.config,
          },
          '*',
        );
        sendResponse({ ok: true });
      }
      return false;
    });
  },
});
