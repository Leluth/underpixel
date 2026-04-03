export const colors = {
  deepBg: '#0f0c24',
  baseBg: '#171330',
  surface: '#221d45',
  surfaceActive: '#2a2350',
  border: '#352e6b',

  textPrimary: '#f0ecff',
  textSecondary: '#e0d8ff',
  textMuted: '#c0b8e8',
  textDim: '#9088c0',

  accent: '#ff8a80',
  accentLight: '#ffab91',

  success: '#a5d6a7',
  warning: '#ffcc80',
  error: '#ef9a9a',
} as const;

export const fonts = {
  pixel: "'Press Start 2P', monospace",
  ui: "'Silkscreen', monospace",
  body: "'VT323', monospace",
} as const;

/** Map HTTP status code to a color token */
export function statusColor(code: number | undefined): string {
  if (!code) return colors.textDim;
  if (code >= 400) return colors.error;
  if (code >= 300) return colors.warning;
  return colors.success;
}

/** Map HTTP method to a display color */
export function methodColor(method: string): string {
  switch (method.toUpperCase()) {
    case 'GET':
      return colors.success;
    case 'POST':
      return colors.warning;
    case 'PUT':
      return colors.warning;
    case 'PATCH':
      return colors.warning;
    case 'DELETE':
      return colors.error;
    default:
      return colors.textSecondary;
  }
}
