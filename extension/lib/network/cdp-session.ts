import { CDP_VERSION } from 'underpixel-shared';

/**
 * Ref-counted Chrome Debugger (CDP) session manager.
 * Multiple features (network capture, screenshots) can share
 * a single debugger attachment to a tab.
 */
class CDPSessionManager {
  /** tabId -> Set of owner names */
  private owners = new Map<number, Set<string>>();

  /** Attach debugger to tab. Ref-counted — safe to call multiple times. */
  async attach(tabId: number, owner: string): Promise<void> {
    const existing = this.owners.get(tabId);
    if (existing) {
      existing.add(owner);
      return; // Already attached
    }

    await chrome.debugger.attach({ tabId }, CDP_VERSION);
    this.owners.set(tabId, new Set([owner]));
  }

  /** Detach from tab (decrements ref count). Only truly detaches when last owner leaves. */
  async detach(tabId: number, owner: string): Promise<void> {
    const owners = this.owners.get(tabId);
    if (!owners) return;

    owners.delete(owner);
    if (owners.size === 0) {
      this.owners.delete(tabId);
      try {
        await chrome.debugger.detach({ tabId });
      } catch {
        // Tab may already be closed
      }
    }
  }

  /** Send a CDP command to a tab. */
  async sendCommand<T = unknown>(
    tabId: number,
    method: string,
    params?: Record<string, unknown>,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(result as T);
        }
      });
    });
  }

  /** Check if we have an active attachment to a tab. */
  isAttached(tabId: number): boolean {
    return this.owners.has(tabId) && this.owners.get(tabId)!.size > 0;
  }

  /** Force-detach all sessions (cleanup on extension unload). */
  async detachAll(): Promise<void> {
    for (const tabId of this.owners.keys()) {
      try {
        await chrome.debugger.detach({ tabId });
      } catch {
        // Ignore
      }
    }
    this.owners.clear();
  }
}

export const cdpSession = new CDPSessionManager();
