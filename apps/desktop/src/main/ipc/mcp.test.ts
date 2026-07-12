import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

import { ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { IPC } from '@chamber/shared';
import type { McpServerEntry } from '@chamber/shared/mcp-types';
import { setupMcpIPC } from './mcp';

const EVT = {} as IpcMainInvokeEvent;
type InvokeHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

describe('MCP IPC', () => {
  const getMindPath = vi.fn<(mindId: string) => string | undefined>();
  const getActiveMindId = vi.fn<() => string | null>();
  const read = vi.fn<(mindPath: string) => McpServerEntry[]>();
  const write = vi.fn<(mindPath: string, servers: McpServerEntry[]) => McpServerEntry[]>();

  beforeEach(() => {
    vi.clearAllMocks();
    getMindPath.mockReturnValue(undefined);
    getActiveMindId.mockReturnValue(null);
    read.mockReturnValue([]);
    write.mockImplementation((_path, servers) => servers);
    setupMcpIPC({ getMindPath, getActiveMindId }, { read, write });
  });

  describe('getServers', () => {
    it('reads from the resolved active mind when no mindId is passed', async () => {
      getActiveMindId.mockReturnValue('lucy');
      getMindPath.mockReturnValue('C:\\minds\\lucy');
      read.mockReturnValue([
        { name: 'files', transport: 'stdio', command: 'npx', args: [], env: {} },
      ]);

      await expect(getHandler(IPC.MCP.GET_SERVERS)(EVT, undefined)).resolves.toEqual([
        { name: 'files', transport: 'stdio', command: 'npx', args: [], env: {} },
      ]);
      expect(getMindPath).toHaveBeenCalledWith('lucy');
      expect(read).toHaveBeenCalledWith('C:\\minds\\lucy');
    });

    it('returns [] when no mind can be resolved', async () => {
      await expect(getHandler(IPC.MCP.GET_SERVERS)(EVT, undefined)).resolves.toEqual([]);
      expect(read).not.toHaveBeenCalled();
    });

    it('rejects a non-string mindId with a channel-labeled TypeError', async () => {
      await expect(getHandler(IPC.MCP.GET_SERVERS)(EVT, 42)).rejects.toThrow(TypeError);
      await expect(getHandler(IPC.MCP.GET_SERVERS)(EVT, 42)).rejects.toThrow(/mcp:getServers/);
      expect(read).not.toHaveBeenCalled();
    });
  });

  describe('setServers', () => {
    it('writes validated entries to the resolved mind path', async () => {
      getMindPath.mockReturnValue('C:\\minds\\lucy');
      const entries: McpServerEntry[] = [
        { name: 'files', transport: 'stdio', command: 'npx', args: ['fs'], env: { A: '1' } },
        { name: 'remote', transport: 'http', url: 'https://mcp.example.test', headers: {} },
      ];

      await expect(getHandler(IPC.MCP.SET_SERVERS)(EVT, entries, 'lucy')).resolves.toEqual(entries);
      expect(write).toHaveBeenCalledWith('C:\\minds\\lucy', entries);
    });

    it('passes preserved fields through validation unchanged', async () => {
      getMindPath.mockReturnValue('C:\\minds\\lucy');
      const entries: McpServerEntry[] = [
        {
          name: 'stream',
          transport: 'http',
          url: 'https://mcp.example.test/sse',
          headers: {},
          preserved: { type: 'sse', tools: ['ping'], timeout: 1000 },
        },
      ];

      await expect(getHandler(IPC.MCP.SET_SERVERS)(EVT, entries, 'lucy')).resolves.toEqual(entries);
      expect(write).toHaveBeenCalledWith('C:\\minds\\lucy', entries);
    });

    it('throws when no mind is selected', async () => {
      const entries: McpServerEntry[] = [
        { name: 'files', transport: 'stdio', command: 'npx', args: [], env: {} },
      ];
      await expect(getHandler(IPC.MCP.SET_SERVERS)(EVT, entries, undefined)).rejects.toThrow(/No mind selected/);
      expect(write).not.toHaveBeenCalled();
    });

    it('rejects a stdio entry with an empty command', async () => {
      getMindPath.mockReturnValue('C:\\minds\\lucy');
      const entries = [{ name: 'files', transport: 'stdio', command: '', args: [], env: {} }];
      await expect(getHandler(IPC.MCP.SET_SERVERS)(EVT, entries, 'lucy')).rejects.toThrow(TypeError);
      expect(write).not.toHaveBeenCalled();
    });

    it('rejects an http entry with an invalid url', async () => {
      getMindPath.mockReturnValue('C:\\minds\\lucy');
      const entries = [{ name: 'remote', transport: 'http', url: 'not-a-url', headers: {} }];
      await expect(getHandler(IPC.MCP.SET_SERVERS)(EVT, entries, 'lucy')).rejects.toThrow(TypeError);
      expect(write).not.toHaveBeenCalled();
    });

    it('rejects an entry that mixes stdio and http keys', async () => {
      getMindPath.mockReturnValue('C:\\minds\\lucy');
      const entries = [{ name: 'x', transport: 'stdio', command: 'a', args: [], env: {}, url: 'https://y.test' }];
      await expect(getHandler(IPC.MCP.SET_SERVERS)(EVT, entries, 'lucy')).rejects.toThrow(TypeError);
      expect(write).not.toHaveBeenCalled();
    });
  });
});

function getHandler(channel: string): InvokeHandler {
  const call = vi.mocked(ipcMain.handle).mock.calls.find((item) => item[0] === channel);
  if (!call) throw new Error(`no handler registered for ${channel}`);
  return call[1] as InvokeHandler;
}
