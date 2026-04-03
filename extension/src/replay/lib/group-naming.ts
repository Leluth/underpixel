/** Generate a display name for a correlation group from its trigger string.
 *  Trigger format from correlation engine: "METHOD /pathname" (e.g., "GET /api/users") */
export function generateGroupName(trigger: string): string {
  if (!trigger) return 'PAGE UPDATE';

  // Navigation events
  if (trigger === 'navigation' || trigger.startsWith('navigate')) {
    return 'PAGE LOAD';
  }

  // API response — extract last meaningful path segment
  // Engine produces "GET /api/users" or "POST /api/v2/user/profile"
  const apiMatch = trigger.match(/^\w+\s+\/(?:api\/)?(?:v\d+\/)?(.+)/i);
  if (apiMatch) {
    const path = apiMatch[1];
    const segments = path.split('/').filter(Boolean);
    const last = segments[segments.length - 1] || path;
    const clean = last
      .split('?')[0]
      .replace(/[^a-zA-Z0-9]/g, ' ')
      .trim();
    return clean.toUpperCase() || 'API CALL';
  }

  // User interaction triggers
  if (trigger.startsWith('click') || trigger.startsWith('input') || trigger.startsWith('scroll')) {
    return 'USER ACTION';
  }

  return 'PAGE UPDATE';
}

/** Pick an RPG-style symbol for a group header */
export function generateGroupSymbol(name: string): string {
  if (name === 'PAGE LOAD') return '★';
  return '♥';
}

/** Format a ms offset as m:ss for group header display */
export function formatGroupTimestamp(offsetMs: number): string {
  const totalSeconds = Math.floor(Math.max(0, offsetMs) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** Build the full display label: "NAME (m:ss)" */
export function formatGroupLabel(
  name: string,
  bundleTimestamp: number,
  sessionStartTime: number,
): string {
  const offset = bundleTimestamp - sessionStartTime;
  return `${name} (${formatGroupTimestamp(offset)})`;
}
