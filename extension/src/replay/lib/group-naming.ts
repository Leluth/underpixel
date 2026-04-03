/** Format a ms offset as m:ss for group header display */
export function formatGroupTimestamp(offsetMs: number): string {
  const totalSeconds = Math.floor(Math.max(0, offsetMs) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
