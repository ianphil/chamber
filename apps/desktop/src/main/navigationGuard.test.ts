import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebContents } from 'electron';

const { mockOpenExternal } = vi.hoisted(() => ({
  mockOpenExternal: vi.fn(),
}));

vi.mock('electron', () => ({
  shell: { openExternal: mockOpenExternal },
}));

import { installExternalNavigationGuard, shouldOpenExternally } from './navigationGuard';

describe('shouldOpenExternally', () => {
  it('opens web URLs outside packaged file views', () => {
    expect(shouldOpenExternally('https://example.com', 'file:///app/index.html')).toBe(true);
  });

  it('allows same-origin app navigation', () => {
    expect(shouldOpenExternally('http://localhost:5173/settings', 'http://localhost:5173/')).toBe(false);
  });

  it('ignores Chamber protocol URLs', () => {
    expect(shouldOpenExternally('chamber://marketplace/install?url=https%3A%2F%2Fexample.com', 'file:///app/index.html')).toBe(false);
  });
});

describe('installExternalNavigationGuard', () => {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const webContents = {
    getURL: vi.fn(),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      listeners.set(event, handler);
      return webContents;
    }),
    setWindowOpenHandler: vi.fn(),
  } as unknown as WebContents;

  beforeEach(() => {
    vi.clearAllMocks();
    listeners.clear();
    vi.mocked(webContents.getURL).mockReturnValue('file:///app/index.html');
  });

  it('denies new windows for external links and opens them in the OS browser', () => {
    installExternalNavigationGuard(webContents);
    const handler = vi.mocked(webContents.setWindowOpenHandler).mock.calls[0][0];

    expect(handler({ url: 'https://example.com' } as Parameters<typeof handler>[0])).toEqual({ action: 'deny' });
    expect(mockOpenExternal).toHaveBeenCalledWith('https://example.com');
  });

  it('prevents external top-level navigation', () => {
    installExternalNavigationGuard(webContents);
    const handler = listeners.get('will-navigate')!;
    const event = { preventDefault: vi.fn() };

    handler(event, 'https://example.com');

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(mockOpenExternal).toHaveBeenCalledWith('https://example.com');
  });
});
