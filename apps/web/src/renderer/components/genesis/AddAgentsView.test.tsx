/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { AddAgentsView } from './AddAgentsView';
import { AppStateProvider, useAppState } from '../../lib/store';
import { installElectronAPI, mockElectronAPI } from '../../../test/helpers';
import type { ElectronAPI } from '@chamber/shared/electron-types';

vi.mock('./GenesisFlow', () => ({
  GenesisFlow: ({ embedded, initialStage }: { embedded?: boolean; initialStage?: string }) => (
    <div data-testid="genesis-flow">{`embedded:${String(embedded)} stage:${initialStage}`}</div>
  ),
}));

function ActiveViewProbe() {
  const { activeView } = useAppState();
  return <div data-testid="active-view">{activeView}</div>;
}

let api: ElectronAPI;

beforeEach(() => {
  api = mockElectronAPI();
  installElectronAPI(api);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AddAgentsView', () => {
  it('renders the embedded genesis marketplace content without the void intro', () => {
    render(
      <AppStateProvider>
        <AddAgentsView />
      </AppStateProvider>,
    );

    expect(screen.getByRole('heading', { name: 'Add Agents' })).toBeTruthy();
    expect(screen.getByTestId('genesis-flow').textContent).toBe('embedded:true stage:voice');
  });

  it('imports an existing agent folder and switches to chat', async () => {
    api.mind.selectDirectory = vi.fn().mockResolvedValue('C:\\agents\\dude');
    api.mind.add = vi.fn().mockResolvedValue({ mindId: 'dude-1', mindPath: 'C:\\agents\\dude', identity: { name: 'Dude', systemMessage: '' }, status: 'ready' });
    api.mind.list = vi.fn().mockResolvedValue([
      { mindId: 'dude-1', mindPath: 'C:\\agents\\dude', identity: { name: 'Dude', systemMessage: '' }, status: 'ready' },
    ]);

    render(
      <AppStateProvider>
        <AddAgentsView />
        <ActiveViewProbe />
      </AppStateProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /Upload from machine/i }));

    await waitFor(() => expect(api.mind.add).toHaveBeenCalledWith('C:\\agents\\dude'));
    await waitFor(() => expect(screen.getByTestId('active-view').textContent).toBe('chat'));
  });

  it('does nothing when the folder picker is cancelled', async () => {
    api.mind.selectDirectory = vi.fn().mockResolvedValue(null);

    render(
      <AppStateProvider>
        <AddAgentsView />
      </AppStateProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /Upload from machine/i }));

    await waitFor(() => expect(api.mind.selectDirectory).toHaveBeenCalled());
    expect(api.mind.add).not.toHaveBeenCalled();
  });

  it('surfaces an error when importing fails', async () => {
    api.mind.selectDirectory = vi.fn().mockResolvedValue('C:\\agents\\bad');
    api.mind.add = vi.fn().mockRejectedValue(new Error('not a valid agent folder'));

    render(
      <AppStateProvider>
        <AddAgentsView />
      </AppStateProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /Upload from machine/i }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('not a valid agent folder');
  });
});
