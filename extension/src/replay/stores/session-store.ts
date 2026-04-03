import { writable } from 'svelte/store';
import type { CaptureSession } from 'underpixel-shared';
import { getAllSessions } from '../lib/db-queries';

export const sessions = writable<CaptureSession[]>([]);
export const sessionsLoading = writable(true);

export async function loadSessions() {
  sessionsLoading.set(true);
  try {
    const all = await getAllSessions();
    sessions.set(all);
  } finally {
    sessionsLoading.set(false);
  }
}
