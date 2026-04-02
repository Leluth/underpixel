/** Validate and coerce tabId from MCP args */
export function resolveTabId(raw: unknown): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  const n = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Invalid tabId: ${raw}`);
  }
  return n;
}

/** Get the active tab ID, or throw */
export async function getActiveTabId(): Promise<number> {
  const [activeTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (!activeTab?.id) throw new Error('No active tab found');
  return activeTab.id;
}
