import { openDB, type IDBPDatabase, type DBSchema } from 'idb';
import type {
  CaptureSession,
  NetworkRequest,
  StoredRrwebEvent,
  StoredScreenshot,
  CorrelationBundle,
} from 'underpixel-shared';

interface ResponseBody {
  requestId: string;
  sessionId: string;
  body: string;
  base64Encoded: boolean;
}

interface UnderPixelDB extends DBSchema {
  sessions: {
    key: string;
    value: CaptureSession;
    indexes: {
      'by-start': number;
      'by-url': string;
    };
  };

  networkRequests: {
    key: string;
    value: NetworkRequest;
    indexes: {
      'by-session': string;
      'by-session-time': [string, number];
    };
  };

  responseBodies: {
    key: string;
    value: ResponseBody;
    indexes: {
      'by-session': string;
    };
  };

  rrwebEvents: {
    key: number;
    value: StoredRrwebEvent;
    indexes: {
      'by-session': string;
      'by-session-time': [string, number];
    };
  };

  screenshots: {
    key: string;
    value: StoredScreenshot;
    indexes: {
      'by-session': string;
      'by-session-time': [string, number];
    };
  };

  correlationBundles: {
    key: string;
    value: CorrelationBundle;
    indexes: {
      'by-session': string;
      'by-session-time': [string, number];
    };
  };
}

const DB_NAME = 'underpixel';
const DB_VERSION = 1;

let dbInstance: IDBPDatabase<UnderPixelDB> | null = null;

export async function db(): Promise<IDBPDatabase<UnderPixelDB>> {
  if (dbInstance) return dbInstance;

  dbInstance = await openDB<UnderPixelDB>(DB_NAME, DB_VERSION, {
    upgrade(database) {
      // Sessions
      const sessions = database.createObjectStore('sessions', { keyPath: 'id' });
      sessions.createIndex('by-start', 'startTime');
      sessions.createIndex('by-url', 'initialUrl');

      // Network Requests
      const requests = database.createObjectStore('networkRequests', {
        keyPath: 'requestId',
      });
      requests.createIndex('by-session', 'sessionId');
      requests.createIndex('by-session-time', ['sessionId', 'startTime']);

      // Response Bodies (large bodies stored separately)
      const bodies = database.createObjectStore('responseBodies', {
        keyPath: 'requestId',
      });
      bodies.createIndex('by-session', 'sessionId');

      // rrweb Events
      const events = database.createObjectStore('rrwebEvents', {
        keyPath: 'id',
        autoIncrement: true,
      });
      events.createIndex('by-session', 'sessionId');
      events.createIndex('by-session-time', ['sessionId', 'timestamp']);

      // Screenshots
      const screenshots = database.createObjectStore('screenshots', {
        keyPath: 'id',
      });
      screenshots.createIndex('by-session', 'sessionId');
      screenshots.createIndex('by-session-time', ['sessionId', 'timestamp']);

      // Correlation Bundles
      const bundles = database.createObjectStore('correlationBundles', {
        keyPath: 'id',
      });
      bundles.createIndex('by-session', 'sessionId');
      bundles.createIndex('by-session-time', ['sessionId', 'timestamp']);
    },
  });

  return dbInstance;
}

/** Get the most recent active or stopped session */
export async function getLatestSession(): Promise<CaptureSession | undefined> {
  const database = await db();
  const all = await database.getAllFromIndex('sessions', 'by-start');
  // Return the latest one (sorted ascending, take last)
  return all[all.length - 1];
}

/** Delete a session and all its related data */
export async function deleteSession(sessionId: string): Promise<void> {
  const database = await db();
  const tx = database.transaction(
    ['sessions', 'networkRequests', 'responseBodies', 'rrwebEvents', 'screenshots', 'correlationBundles'],
    'readwrite',
  );

  // Delete from each store by session index
  const stores = ['networkRequests', 'responseBodies', 'rrwebEvents', 'screenshots', 'correlationBundles'] as const;
  for (const storeName of stores) {
    const store = tx.objectStore(storeName);
    const index = store.index('by-session');
    let cursor = await index.openCursor(sessionId);
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
  }

  await tx.objectStore('sessions').delete(sessionId);
  await tx.done;
}

/** Clean up sessions older than maxAge (ms). Default: 7 days */
export async function cleanupOldSessions(maxAge = 7 * 24 * 60 * 60 * 1000): Promise<number> {
  const database = await db();
  const cutoff = Date.now() - maxAge;
  const all = await database.getAllFromIndex('sessions', 'by-start');
  let deleted = 0;

  for (const session of all) {
    if (session.startTime < cutoff) {
      await deleteSession(session.id);
      deleted++;
    }
  }

  return deleted;
}
