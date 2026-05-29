/**
 * True when running on macOS. Used to offset chrome for the inset traffic-light
 * window controls produced by Electron's `titleBarStyle: 'hiddenInset'`.
 */
export const isMac =
  typeof navigator !== 'undefined' && navigator.userAgent.includes('Macintosh');
