import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  dialog: { showOpenDialog: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn(), getAllWindows: vi.fn().mockReturnValue([]) },
}));

import { BrowserWindow, dialog, ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { setupSquadIPC } from './squad';
import type { SquadRoomService } from '@chamber/services';
import type { SquadRoomEvent } from '@chamber/shared/squad-types';

type InvokeHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

const EVT = { sender: {} } as IpcMainInvokeEvent;

describe('setupSquadIPC', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValue({} as never);
  });

  it('registers Squad room handlers', () => {
    setupSquadIPC(createService());

    const channels = vi.mocked(ipcMain.handle).mock.calls.map((call) => call[0]);

    expect(channels).toContain('squad:get-room');
    expect(channels).toContain('squad:select-repository');
    expect(channels).toContain('squad:history');
    expect(channels).toContain('squad:send');
    expect(channels).toContain('squad:stop');
    expect(channels).toContain('squad:clear');
  });

  it('gets a room for a repo path', async () => {
    const service = createService();
    setupSquadIPC(service);

    await expect(getHandler('squad:get-room')(EVT, 'C:\\src\\cmux')).resolves.toMatchObject({
      status: 'ready',
      repoPath: 'C:\\src\\cmux',
    });
    expect(service.getRoom).toHaveBeenCalledWith('C:\\src\\cmux');
  });

  it('rejects invalid get-room args without calling the service', async () => {
    const service = createService();
    setupSquadIPC(service);

    await expect(getHandler('squad:get-room')(EVT, 123)).rejects.toThrow(TypeError);
    expect(service.getRoom).not.toHaveBeenCalled();
  });

  it('returns the selected repository room', async () => {
    const service = createService();
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: ['C:\\src\\cmux'] });
    setupSquadIPC(service);

    await expect(getHandler('squad:select-repository')(EVT)).resolves.toMatchObject({
      status: 'ready',
      repoPath: 'C:\\src\\cmux',
    });
  });

  it('returns null when repository selection is canceled', async () => {
    const service = createService();
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: true, filePaths: [] });
    setupSquadIPC(service);

    await expect(getHandler('squad:select-repository')(EVT)).resolves.toBeNull();
    expect(service.getRoom).not.toHaveBeenCalled();
  });

  it('returns transcript history', async () => {
    const service = createService();
    setupSquadIPC(service);

    await expect(getHandler('squad:history')(EVT, 'C:\\src\\cmux')).resolves.toEqual([]);
    expect(service.history).toHaveBeenCalledWith('C:\\src\\cmux');
  });

  it('sends a Squad Room request', async () => {
    const service = createService();
    setupSquadIPC(service);

    await expect(getHandler('squad:send')(EVT, {
      roomId: 'C:\\src\\cmux',
      repoPath: 'C:\\src\\cmux',
      prompt: 'hello',
      targetAgentName: 'Shiherlis',
    })).resolves.toMatchObject({ success: true });
    expect(service.send).toHaveBeenCalledWith({
      roomId: 'C:\\src\\cmux',
      repoPath: 'C:\\src\\cmux',
      prompt: 'hello',
      targetAgentName: 'Shiherlis',
    });
  });

  it('rejects invalid send args without calling the service', async () => {
    const service = createService();
    setupSquadIPC(service);

    await expect(getHandler('squad:send')(EVT, { roomId: 'room', repoPath: 'repo', prompt: '' })).rejects.toThrow(TypeError);
    expect(service.send).not.toHaveBeenCalled();
  });

  it('stops and clears Squad Room state', async () => {
    const service = createService();
    setupSquadIPC(service);

    await expect(getHandler('squad:stop')(EVT, 'turn-1')).resolves.toBeUndefined();
    await expect(getHandler('squad:clear')(EVT, 'C:\\src\\cmux')).resolves.toBeUndefined();
    expect(service.stop).toHaveBeenCalledWith('turn-1');
    expect(service.clear).toHaveBeenCalledWith('C:\\src\\cmux');
  });

  it('forwards Squad events to windows', () => {
    const win = { webContents: { send: vi.fn() } };
    const service = createService();
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([win] as never);
    setupSquadIPC(service);

    service.emitEventForTest({ type: 'canceled', roomId: 'room-1', turnId: 'turn-1' });

    expect(win.webContents.send).toHaveBeenCalledWith('squad:event', { type: 'canceled', roomId: 'room-1', turnId: 'turn-1' });
  });
});

function getHandler(name: string): InvokeHandler {
  const call = vi.mocked(ipcMain.handle).mock.calls.find((item) => item[0] === name);
  if (!call) throw new Error(`no handler registered for ${name}`);
  return call[1] as InvokeHandler;
}

function createService(): SquadRoomService & {
  getRoom: ReturnType<typeof vi.fn>;
  history: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
  emitEventForTest: (event: SquadRoomEvent) => void;
} {
  const listeners: Parameters<SquadRoomService['onEvent']>[0][] = [];
  return {
    onEvent: vi.fn().mockImplementation((callback: Parameters<SquadRoomService['onEvent']>[0]) => {
      listeners.push(callback);
      return vi.fn();
    }),
    getRoom: vi.fn().mockImplementation((repoPath: string | null | undefined) => Promise.resolve({
      id: repoPath ?? 'unselected',
      repoPath: repoPath ?? null,
      repoName: repoPath ? 'cmux' : null,
      squadPath: repoPath ? `${repoPath}\\.squad` : null,
      status: repoPath ? 'ready' : 'unselected',
      version: repoPath ? 1 : null,
      coordinator: null,
      agents: [],
      routingRules: [],
      decisions: [],
      directives: null,
      sessions: [],
      lastError: null,
    })),
    history: vi.fn().mockResolvedValue([]),
    send: vi.fn().mockResolvedValue({
      success: true,
      turnId: 'turn-1',
      message: {
        id: 'message-1',
        roomId: 'C:\\src\\cmux',
        turnId: 'turn-1',
        role: 'assistant',
        sender: { kind: 'squad-agent', id: 'Shiherlis', name: 'Shiherlis' },
        content: 'hello',
        timestamp: 1,
      },
    }),
    stop: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
    emitEventForTest: (event: SquadRoomEvent) => listeners.forEach((listener) => listener(event)),
  } as unknown as SquadRoomService & {
    getRoom: ReturnType<typeof vi.fn>;
    history: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    clear: ReturnType<typeof vi.fn>;
    emitEventForTest: (event: SquadRoomEvent) => void;
  };
}
