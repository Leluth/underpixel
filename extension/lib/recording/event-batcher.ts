import type { StoredRrwebEvent } from 'underpixel-shared';
import { db } from '../storage/db';
import { correlationEngine } from '../correlation/engine';

const BATCH_INTERVAL = 200; // ms

/** Per-session event buffer */
const buffers = new Map<string, StoredRrwebEvent[]>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/** Queue an rrweb event for batched IndexedDB write */
export function enqueueRrwebEvent(sessionId: string, event: StoredRrwebEvent): void {
  if (!buffers.has(sessionId)) {
    buffers.set(sessionId, []);
  }
  buffers.get(sessionId)!.push(event);

  // Notify correlation engine immediately (doesn't need to wait for DB write)
  correlationEngine.onDomMutation(sessionId, event);

  // Schedule flush if not already pending
  if (!flushTimer) {
    flushTimer = setTimeout(flushAll, BATCH_INTERVAL);
  }
}

/** Flush all buffered events to IndexedDB */
async function flushAll(): Promise<void> {
  flushTimer = null;

  for (const [sessionId, events] of buffers) {
    if (events.length === 0) continue;

    // Take the buffer and clear it
    const batch = events.splice(0);

    try {
      const database = await db();
      const tx = database.transaction(['rrwebEvents', 'sessions'], 'readwrite');

      // Bulk add events
      const store = tx.objectStore('rrwebEvents');
      for (const event of batch) {
        store.add(event);
      }

      // Update session stats once for the whole batch
      const sessionStore = tx.objectStore('sessions');
      const session = await sessionStore.get(sessionId);
      if (session) {
        session.stats.rrwebEventCount += batch.length;
        sessionStore.put(session);
      }

      await tx.done;
    } catch (err) {
      console.error(`[UnderPixel] Failed to flush ${batch.length} rrweb events:`, err);
    }
  }
}

/** Force-flush remaining events (call on capture stop) */
export async function flushPendingEvents(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  await flushAll();
}

/** Clear buffers for a session */
export function clearSessionBuffer(sessionId: string): void {
  buffers.delete(sessionId);
}
