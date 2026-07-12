/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MindContext } from '@chamber/shared/types';
import type { McpServerEntry } from '@chamber/shared/mcp-types';
import { installElectronAPI, mockElectronAPI } from '../../../test/helpers';
import { AppStateProvider, useAppDispatch } from '../../lib/store';
import type { AppState } from '../../lib/store/state';
import { McpServersTab } from './McpServersTab';

function makeMind(id: string, name: string): MindContext {
  return { mindId: id, mindPath: `C:\\minds\\${id}`, identity: { name, systemMessage: '' }, status: 'ready' };
}

const mind = makeMind('mind-1', 'Lucy');

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function renderTab(api: ReturnType<typeof mockElectronAPI>, state?: Partial<AppState>) {
  installElectronAPI(api);
  return render(
    <AppStateProvider testInitialState={{ activeMindId: 'mind-1', minds: [mind], ...state }}>
      <McpServersTab />
    </AppStateProvider>,
  );
}

describe('McpServersTab', () => {
  let api: ReturnType<typeof mockElectronAPI>;

  beforeEach(() => {
    api = mockElectronAPI();
  });

  it('prompts to select a mind when none is active', () => {
    renderTab(api, { activeMindId: null, minds: [] });
    expect(screen.getByText('No mind selected')).toBeTruthy();
  });

  it('lists the configured servers for the active mind', async () => {
    vi.mocked(api.mcp.getServers).mockResolvedValue([
      { name: 'files', transport: 'stdio', command: 'npx', args: ['fs'], env: {} },
      { name: 'remote', transport: 'http', url: 'https://mcp.example.test', headers: {} },
    ]);
    renderTab(api);

    await waitFor(() => expect(screen.getByText('files')).toBeTruthy());
    expect(api.mcp.getServers).toHaveBeenCalledWith('mind-1');
    expect(screen.getByText('remote')).toBeTruthy();
    expect(screen.getByText('https://mcp.example.test')).toBeTruthy();
  });

  it('disables writes until the active mind has loaded', async () => {
    const pending = deferred<McpServerEntry[]>();
    vi.mocked(api.mcp.getServers).mockReturnValue(pending.promise);
    renderTab(api);

    const addButton = () => screen.getByRole('button', { name: 'Add server' }) as HTMLButtonElement;
    expect(addButton().disabled).toBe(true);

    pending.resolve([]);
    await waitFor(() => expect(addButton().disabled).toBe(false));
  });

  it('adds a new stdio server and persists it', async () => {
    vi.mocked(api.mcp.getServers).mockResolvedValue([]);
    const saved: McpServerEntry[] = [{ name: 'files', transport: 'stdio', command: 'npx', args: ['fs'], env: {} }];
    vi.mocked(api.mcp.setServers).mockResolvedValue(saved);
    renderTab(api);

    await waitFor(() => expect((screen.getByRole('button', { name: 'Add server' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Add server' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'files' } });
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'npx' } });
    fireEvent.change(screen.getByLabelText('Arguments'), { target: { value: 'fs' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save server' }));

    await waitFor(() => {
      expect(api.mcp.setServers).toHaveBeenCalledWith(
        [{ name: 'files', transport: 'stdio', command: 'npx', args: ['fs'], env: {} }],
        'mind-1',
      );
    });
    await waitFor(() => expect(screen.getByText('files')).toBeTruthy());
  });

  it('shows a validation error and does not persist an empty name', async () => {
    vi.mocked(api.mcp.getServers).mockResolvedValue([]);
    renderTab(api);

    await waitFor(() => expect((screen.getByRole('button', { name: 'Add server' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Add server' }));
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'npx' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save server' }));

    await waitFor(() => expect(screen.getByText('Name is required.')).toBeTruthy());
    expect(api.mcp.setServers).not.toHaveBeenCalled();
  });

  it('carries preserved fields through an edit so the tools allowlist survives', async () => {
    const original: McpServerEntry = {
      name: 'files',
      transport: 'stdio',
      command: 'npx',
      args: [],
      env: {},
      preserved: { type: 'stdio', tools: ['read'] },
    };
    vi.mocked(api.mcp.getServers).mockResolvedValue([original]);
    vi.mocked(api.mcp.setServers).mockResolvedValue([]);
    renderTab(api);

    fireEvent.click(await screen.findByRole('button', { name: 'Edit files' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'renamed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save server' }));

    await waitFor(() => {
      expect(api.mcp.setServers).toHaveBeenCalledWith(
        [{ ...original, name: 'renamed' }],
        'mind-1',
      );
    });
  });

  it('removes a server and persists the remaining set', async () => {
    vi.mocked(api.mcp.getServers).mockResolvedValue([
      { name: 'files', transport: 'stdio', command: 'npx', args: [], env: {} },
    ]);
    vi.mocked(api.mcp.setServers).mockResolvedValue([]);
    renderTab(api);

    fireEvent.click(await screen.findByRole('button', { name: 'Remove files' }));

    await waitFor(() => expect(api.mcp.setServers).toHaveBeenCalledWith([], 'mind-1'));
  });

  it('ignores a stale load and writes to the newly active mind (blocker 3)', async () => {
    const mindA = makeMind('mind-a', 'Ada');
    const mindB = makeMind('mind-b', 'Boris');
    const loadA = deferred<McpServerEntry[]>();
    const loadB = deferred<McpServerEntry[]>();
    vi.mocked(api.mcp.getServers).mockImplementation((id?: string) =>
      id === 'mind-a' ? loadA.promise : loadB.promise,
    );
    vi.mocked(api.mcp.setServers).mockResolvedValue([]);

    function Harness() {
      const dispatch = useAppDispatch();
      return (
        <>
          <button onClick={() => dispatch({ type: 'SET_ACTIVE_MIND', payload: 'mind-b' })}>switch</button>
          <McpServersTab />
        </>
      );
    }

    installElectronAPI(api);
    render(
      <AppStateProvider testInitialState={{ activeMindId: 'mind-a', minds: [mindA, mindB] }}>
        <Harness />
      </AppStateProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'switch' }));
    loadB.resolve([{ name: 'b-server', transport: 'stdio', command: 'b', args: [], env: {} }]);
    await screen.findByText('b-server');

    // The late response for the previously-active mind must not overwrite B.
    loadA.resolve([{ name: 'a-server', transport: 'stdio', command: 'a', args: [], env: {} }]);
    await waitFor(() => expect(screen.queryByText('a-server')).toBeNull());
    expect(screen.getByText('b-server')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Remove b-server' }));
    await waitFor(() => expect(api.mcp.setServers).toHaveBeenCalledWith([], 'mind-b'));
  });
});
