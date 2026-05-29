import React from 'react';
import { isMac } from '../../lib/platform';

export function MacTitlebarDrag() {
  if (!isMac) return null;
  return <div className="titlebar-drag fixed top-0 left-0 right-0 h-7 z-[60] pointer-events-none" />;
}
