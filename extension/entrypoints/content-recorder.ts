/**
 * Content script — MAIN world.
 * Runs rrweb.record() and PerformanceObserver in the page's real context.
 * Communicates with the ISOLATED world content script via window.postMessage.
 */
import { record } from 'rrweb';

export default defineContentScript({
  matches: ['<all_urls>'],
  world: 'MAIN',
  runAt: 'document_idle',
  main() {
    let stopFn: (() => void) | null = null;

    // Listen for commands from ISOLATED world
    window.addEventListener('message', (e) => {
      if (e.source !== window) return;
      const data = e.data;
      if (!data || data.source !== 'underpixel-control') return;

      if (data.action === 'start-recording') {
        if (stopFn) return; // Already recording

        try {
          stopFn =
            record({
              emit(event, isCheckout) {
                window.postMessage(
                  {
                    source: 'underpixel-event',
                    type: 'rrweb',
                    event,
                    isCheckout,
                  },
                  '*',
                );
              },
              sampling: data.config?.sampling || {
                mousemove: 100,
                scroll: 150,
                input: 'last',
              },
              maskAllInputs: data.config?.maskInputs ?? false,
              maskTextSelector: data.config?.maskTextSelector,
              blockSelector: '.underpixel-block',
              slimDOMOptions: 'all',
              recordAfter: 'DOMContentLoaded',
            }) || null;

          console.log('[UnderPixel] Recording started');
        } catch (err) {
          console.error('[UnderPixel] Failed to start rrweb recording:', err);
        }
      }

      if (data.action === 'stop-recording') {
        if (stopFn) {
          stopFn();
          stopFn = null;
          console.log('[UnderPixel] Recording stopped');
        }
      }
    });

    // PerformanceObserver for layout shifts
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.postMessage(
            {
              source: 'underpixel-event',
              type: 'layout-shift',
              value: (entry as any).value,
              timestamp: performance.timeOrigin + entry.startTime,
            },
            '*',
          );
        }
      });
      observer.observe({ type: 'layout-shift', buffered: false });
    } catch {
      // PerformanceObserver may not support layout-shift in all browsers
    }
  },
});
