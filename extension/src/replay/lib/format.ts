/** Format a duration in ms to a human-readable string */
export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || ms === null) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Format a ms offset as mm:ss.SSS */
export function formatTimestamp(ms: number): string {
  const rounded = Math.round(ms);
  const totalSeconds = Math.floor(rounded / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const millis = rounded % 1000;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

/** Extract pathname + query from a full URL, or return as-is */
export function shortenUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname + parsed.search;
  } catch {
    return url;
  }
}

/** Extract hostname from a URL, or return as-is on failure */
export function hostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** Format a session duration as "Xm YYs" */
export function formatSessionDuration(startTime: number, endTime?: number): string {
  const dur = (endTime ?? Date.now()) - startTime;
  const seconds = Math.floor(dur / 1000);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

/** Detect if a string contains binary/non-printable characters */
export function isBinary(str: string): boolean {
  if (!str) return false;
  const sample = str.slice(0, 500);
  let nonText = 0;
  for (let i = 0; i < sample.length; i++) {
    const code = sample.charCodeAt(i);
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) nonText++;
    else if (code >= 127 && code <= 159) nonText++;
    else if (code > 255) nonText++;
  }
  return sample.length > 0 && nonText / sample.length > 0.1;
}
