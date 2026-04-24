import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NativeImage } from 'electron';

const { getFileIcon, createFromDataURL } = vi.hoisted(() => ({
  getFileIcon: vi.fn(),
  createFromDataURL: vi.fn(),
}));

vi.mock('electron', () => ({
  app: { getFileIcon },
  nativeImage: { createFromDataURL },
  Menu: { buildFromTemplate: vi.fn() },
  Tray: vi.fn(),
}));

import { loadAppIcon } from './Tray';

function makeIcon(empty = false): NativeImage {
  const icon = {
    isEmpty: vi.fn(() => empty),
    resize: vi.fn(() => icon),
  };

  return icon as unknown as NativeImage;
}

describe('loadAppIcon', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the executable icon when Electron provides one', async () => {
    const executableIcon = makeIcon(false);
    getFileIcon.mockResolvedValue(executableIcon);

    const icon = await loadAppIcon();

    expect(getFileIcon).toHaveBeenCalledWith(process.execPath, { size: 'large' });
    expect(createFromDataURL).not.toHaveBeenCalled();
    expect(icon).toBe(executableIcon);
  });

  it('falls back to the generated icon when the executable icon is empty', async () => {
    const fallbackIcon = makeIcon(false);
    getFileIcon.mockResolvedValue(makeIcon(true));
    createFromDataURL.mockReturnValue(fallbackIcon);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const icon = await loadAppIcon();

    expect(createFromDataURL).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledOnce();
    expect(icon).toBe(fallbackIcon);
    warn.mockRestore();
  });

  it('falls back to the generated icon when executable icon lookup fails', async () => {
    const fallbackIcon = makeIcon(false);
    const error = new Error('boom');
    getFileIcon.mockRejectedValue(error);
    createFromDataURL.mockReturnValue(fallbackIcon);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const icon = await loadAppIcon();

    expect(createFromDataURL).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith('[tray] Failed to load executable icon:', error);
    expect(icon).toBe(fallbackIcon);
    consoleError.mockRestore();
  });
});
