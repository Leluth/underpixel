/** Generate a display name for a correlation group from its trigger string */
export function generateGroupName(trigger: string): string {
  if (!trigger) return 'ACTIVITY';

  // Navigation events
  if (trigger === 'navigation' || trigger.startsWith('navigate')) {
    return 'PAGE LOAD';
  }

  // Fetch/XHR response — extract last path segment
  const fetchMatch = trigger.match(/fetch response:\s*\w+\s+\/(?:api\/)?(?:v\d+\/)?(.+)/i);
  if (fetchMatch) {
    const path = fetchMatch[1];
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

  return 'ACTIVITY';
}

/** Pick an RPG-style symbol for a group header */
export function generateGroupSymbol(name: string): string {
  if (name === 'PAGE LOAD') return '★';
  if (name === 'OTHER CALLS') return '♦';
  return '♥';
}
