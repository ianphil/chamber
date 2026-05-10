import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContextMenuParams, WebContents } from 'electron';

const { mockBuildFromTemplate, mockPopup, mockFromWebContents } = vi.hoisted(() => ({
  mockBuildFromTemplate: vi.fn(),
  mockPopup: vi.fn(),
  mockFromWebContents: vi.fn(),
}));

vi.mock('electron', () => ({
  Menu: { buildFromTemplate: mockBuildFromTemplate },
  BrowserWindow: { fromWebContents: mockFromWebContents },
}));

import { buildContextMenuTemplate, installContextMenu } from './ContextMenu';

function makeParams(overrides: {
  isEditable?: boolean;
  selectionText?: string;
  editFlags?: Partial<ContextMenuParams['editFlags']>;
} = {}): ContextMenuParams {
  const { editFlags: editFlagsOverride, ...rest } = overrides;
  return {
    isEditable: false,
    selectionText: '',
    ...rest,
    editFlags: {
      canCut: false,
      canCopy: false,
      canPaste: false,
      canSelectAll: false,
      canDelete: false,
      canUndo: false,
      canRedo: false,
      ...editFlagsOverride,
    },
  } as ContextMenuParams;
}

describe('buildContextMenuTemplate', () => {
  it('returns Cut/Copy/Paste/separator/SelectAll for editable input with no selection and canPaste', () => {
    const params = makeParams({
      isEditable: true,
      editFlags: { canCut: false, canCopy: false, canPaste: true, canSelectAll: true },
    });

    const result = buildContextMenuTemplate(params);

    expect(result).toHaveLength(5);
    expect(result[0]).toEqual({ role: 'cut', label: 'Cut', enabled: false });
    expect(result[1]).toEqual({ role: 'copy', label: 'Copy', enabled: false });
    expect(result[2]).toEqual({ role: 'paste', label: 'Paste', enabled: true });
    expect(result[3]).toEqual({ type: 'separator' });
    expect(result[4]).toEqual({ role: 'selectAll', label: 'Select All', enabled: true });
  });

  it('returns all items enabled when editable with selection and all editFlags set', () => {
    const params = makeParams({
      isEditable: true,
      selectionText: 'hello',
      editFlags: { canCut: true, canCopy: true, canPaste: true, canSelectAll: true },
    });

    const result = buildContextMenuTemplate(params);

    expect(result).toHaveLength(5);
    expect(result[0]).toEqual({ role: 'cut', label: 'Cut', enabled: true });
    expect(result[1]).toEqual({ role: 'copy', label: 'Copy', enabled: true });
    expect(result[2]).toEqual({ role: 'paste', label: 'Paste', enabled: true });
    expect(result[3]).toEqual({ type: 'separator' });
    expect(result[4]).toEqual({ role: 'selectAll', label: 'Select All', enabled: true });
  });

  it('shows Paste disabled when clipboard is empty', () => {
    const params = makeParams({
      isEditable: true,
      editFlags: { canCut: false, canCopy: false, canPaste: false, canSelectAll: true },
    });

    const result = buildContextMenuTemplate(params);

    expect(result).toHaveLength(5);
    expect(result[2]).toEqual({ role: 'paste', label: 'Paste', enabled: false });
    expect(result[3]).toEqual({ type: 'separator' });
  });

  it('returns only Copy/separator/SelectAll for readonly text with selection', () => {
    const params = makeParams({
      isEditable: false,
      selectionText: 'selected text',
      editFlags: { canCopy: true, canSelectAll: true },
    });

    const result = buildContextMenuTemplate(params);

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ role: 'copy', label: 'Copy', enabled: true });
    expect(result[1]).toEqual({ type: 'separator' });
    expect(result[2]).toEqual({ role: 'selectAll', label: 'Select All', enabled: true });
    // No Cut or Paste
    expect(result.find((item) => 'role' in item && item.role === 'cut')).toBeUndefined();
    expect(result.find((item) => 'role' in item && item.role === 'paste')).toBeUndefined();
  });

  it('returns empty array for readonly text with no selection', () => {
    const params = makeParams({ isEditable: false, selectionText: '' });

    const result = buildContextMenuTemplate(params);

    expect(result).toEqual([]);
  });
});

describe('installContextMenu', () => {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const webContents = {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      listeners.set(event, handler);
      return webContents;
    }),
  } as unknown as WebContents;

  beforeEach(() => {
    vi.clearAllMocks();
    listeners.clear();
  });

  it('registers exactly one context-menu listener', () => {
    installContextMenu(webContents);

    expect(webContents.on).toHaveBeenCalledOnce();
    expect(webContents.on).toHaveBeenCalledWith('context-menu', expect.any(Function));
  });

  it('skips Menu.buildFromTemplate and popup when template is empty', () => {
    installContextMenu(webContents);
    const handler = listeners.get('context-menu')!;
    const params = makeParams({ isEditable: false, selectionText: '' });

    handler({} /* event */, params);

    expect(mockBuildFromTemplate).not.toHaveBeenCalled();
    expect(mockPopup).not.toHaveBeenCalled();
  });

  it('calls popup with the window when BrowserWindow.fromWebContents returns a window', () => {
    const fakeWindow = { id: 1 };
    mockFromWebContents.mockReturnValue(fakeWindow);
    mockBuildFromTemplate.mockReturnValue({ popup: mockPopup });

    installContextMenu(webContents);
    const handler = listeners.get('context-menu')!;
    const params = makeParams({
      isEditable: true,
      editFlags: { canPaste: true, canSelectAll: true },
    });

    handler({} /* event */, params);

    expect(mockBuildFromTemplate).toHaveBeenCalledOnce();
    expect(mockPopup).toHaveBeenCalledOnce();
    expect(mockPopup).toHaveBeenCalledWith({ window: fakeWindow });
  });

  it('calls popup with undefined when BrowserWindow.fromWebContents returns null', () => {
    mockFromWebContents.mockReturnValue(null);
    mockBuildFromTemplate.mockReturnValue({ popup: mockPopup });

    installContextMenu(webContents);
    const handler = listeners.get('context-menu')!;
    const params = makeParams({
      isEditable: true,
      editFlags: { canPaste: true, canSelectAll: true },
    });

    handler({} /* event */, params);

    expect(mockPopup).toHaveBeenCalledOnce();
    expect(mockPopup).toHaveBeenCalledWith(undefined);
  });
});
