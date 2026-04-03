import { db } from '../../../lib/storage/db';
import type {
  CaptureSession,
  NetworkRequest,
  StoredRrwebEvent,
  CorrelationBundle,
} from 'underpixel-shared';

/** Get all sessions, sorted newest first */
export async function getAllSessions(): Promise<CaptureSession[]> {
  const database = await db();
  const sessions = await database.getAllFromIndex('sessions', 'by-start');
  return sessions.reverse();
}

/** Get a session by ID */
export async function getSession(sessionId: string): Promise<CaptureSession | undefined> {
  const database = await db();
  return database.get('sessions', sessionId);
}

/** Get all rrweb events for a session, sorted by timestamp */
export async function getRrwebEvents(sessionId: string): Promise<StoredRrwebEvent[]> {
  const database = await db();
  return database.getAllFromIndex('rrwebEvents', 'by-session', sessionId);
}

/** Get all network requests for a session, sorted by startTime (uses compound index) */
export async function getNetworkRequests(sessionId: string): Promise<NetworkRequest[]> {
  const database = await db();
  const range = IDBKeyRange.bound([sessionId, 0], [sessionId, Infinity]);
  return database.getAllFromIndex('networkRequests', 'by-session-time', range);
}

/** Get all correlation bundles for a session, sorted by timestamp (uses compound index) */
export async function getCorrelationBundles(sessionId: string): Promise<CorrelationBundle[]> {
  const database = await db();
  const range = IDBKeyRange.bound([sessionId, 0], [sessionId, Infinity]);
  return database.getAllFromIndex('correlationBundles', 'by-session-time', range);
}

/** Get full response body (for large bodies stored separately) */
export async function getResponseBody(requestId: string): Promise<string | undefined> {
  const database = await db();
  const body = await database.get('responseBodies', requestId);
  return body?.body;
}
