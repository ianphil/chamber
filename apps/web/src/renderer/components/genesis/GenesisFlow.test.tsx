/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { GenesisFlow } from './GenesisFlow';
import { AppStateProvider, useAppState } from '../../lib/store';
import { installElectronAPI, mockElectronAPI } from '../../../test/helpers';
import type { GenesisMindTemplate, MindContext } from '@chamber/shared/types';

vi.mock('./VoidScreen', () => ({
  VoidScreen: ({
    onBegin,
    onAddMarketplace,
  }: {
    onBegin: () => void;
    onAddMarketplace: (url: string) => Promise<{ success: boolean; message: string }>;
  }) => (
    <div>
      <button onClick={onBegin}>Begin</button>
      <button onClick={() => { void onAddMarketplace('https://github.com/agency-microsoft/genesis-minds'); }}>
        Add Marketplace
      </button>
    </div>
  ),
}));

vi.mock('./VoiceScreen', () => ({
  VoiceScreen: ({
    templates,
    templateError,
    onSelect,
    onSelectTemplate,
  }: {
    templates: GenesisMindTemplate[];
    templateError: string | null;
    onSelect: (voice: string, description: string) => void;
    onSelectTemplate: (template: GenesisMindTemplate) => void;
  }) => (
    <div>
      {templateError ? <div role="alert">{templateError}</div> : null}
      <button onClick={() => onSelect('Test Agent', 'Test voice')}>Choose voice</button>
      {templates[0] ? <button onClick={() => onSelectTemplate(templates[0])}>Choose template</button> : null}
    </div>
  ),
}));

vi.mock('./RoleScreen', () => ({
  RoleScreen: ({ onSelect }: { onSelect: (role: string) => void }) => (
    <button onClick={() => onSelect('Chief of Staff')}>Choose role</button>
  ),
}));

vi.mock('./BootScreen', () => ({
  BootScreen: ({ onComplete }: { onComplete: () => void }) => <button onClick={onComplete}>Boot complete</button>,
}));

const createdMind: MindContext = {
  mindId: 'test-agent-1234',
  mindPath: 'C:\\agents\\test-agent',
  identity: { name: 'Test Agent', systemMessage: '# Test Agent' },
  status: 'ready',
};

const otherMind: MindContext = {
  mindId: 'other-agent-1234',
  mindPath: 'C:\\agents\\other-agent',
  identity: { name: 'Other Agent', systemMessage: '# Other Agent' },
  status: 'ready',
};

const lucyTemplate: GenesisMindTemplate = {
  id: 'lucy',
  displayName: 'Lucy',
  description: 'A calm Chief of Staff mind.',
  role: 'Chief of Staff',
  voice: 'Vanilla, calm, helpful, and precise',
  templateVersion: '0.1.0',
  agent: '.github/agents/lucy.agent.md',
  requiredFiles: ['SOUL.md'],
  source: {
    owner: 'ianphil',
    repo: 'genesis-minds',
    ref: 'master',
    plugin: 'genesis-minds',
    manifestPath: 'plugins/genesis-minds/minds/lucy/mind.json',
    rootPath: 'plugins/genesis-minds/minds/lucy',
  },
};

function ActiveMindProbe() {
  const { activeMindId } = useAppState();
  return <div data-testid="active-mind-id">{activeMindId}</div>;
}

describe('GenesisFlow', () => {
  let api: ReturnType<typeof mockElectronAPI>;

  beforeEach(() => {
    api = installElectronAPI();
    (api.genesis.listTemplates as ReturnType<typeof vi.fn>).mockResolvedValue([lucyTemplate]);
  });

  afterEach(() => {
    cleanup();
  });

  it('waits for genesis.create to load the new mind before completing', async () => {
    let resolveCreate: (value: { success: true; mindId: string; mindPath: string }) => void = () => {};
    (api.genesis.create as ReturnType<typeof vi.fn>).mockReturnValue(new Promise((resolve) => {
      resolveCreate = resolve;
    }));
    (api.mind.list as ReturnType<typeof vi.fn>).mockResolvedValue([createdMind]);
    const onComplete = vi.fn();

    render(
      <AppStateProvider>
        <GenesisFlow onComplete={onComplete} />
      </AppStateProvider>,
    );

    fireEvent.click(screen.getByText('Begin'));
    fireEvent.click(screen.getByText('Choose voice'));
    fireEvent.click(await screen.findByText('Choose role'));
    fireEvent.click(await screen.findByText('Boot complete'));

    expect(api.mind.list).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();

    resolveCreate({ success: true, mindId: createdMind.mindId, mindPath: createdMind.mindPath });

    await waitFor(() => {
      expect(api.mind.list).toHaveBeenCalled();
      expect(onComplete).toHaveBeenCalled();
    });
  });

  it('selects the mind path returned by genesis.create instead of the last listed mind', async () => {
    let resolveCreate: (value: { success: true; mindId?: string; mindPath: string }) => void = () => {};
    (api.genesis.create as ReturnType<typeof vi.fn>).mockReturnValue(new Promise((resolve) => {
      resolveCreate = resolve;
    }));
    (api.mind.list as ReturnType<typeof vi.fn>).mockResolvedValue([createdMind, otherMind]);

    render(
      <AppStateProvider>
        <GenesisFlow onComplete={vi.fn()} />
        <ActiveMindProbe />
      </AppStateProvider>,
    );

    fireEvent.click(screen.getByText('Begin'));
    fireEvent.click(screen.getByText('Choose voice'));
    fireEvent.click(await screen.findByText('Choose role'));
    fireEvent.click(await screen.findByText('Boot complete'));

    resolveCreate({ success: true, mindPath: createdMind.mindPath.toUpperCase() });

    await waitFor(() => {
      expect(screen.getByTestId('active-mind-id').textContent).toBe(createdMind.mindId);
    });
  });

  it('installs predefined marketplace templates without invoking generated creation', async () => {
    let resolveCreate: (value: { success: true; mindId: string; mindPath: string }) => void = () => {};
    (api.genesis.createFromTemplate as ReturnType<typeof vi.fn>).mockReturnValue(new Promise((resolve) => {
      resolveCreate = resolve;
    }));
    (api.mind.list as ReturnType<typeof vi.fn>).mockResolvedValue([createdMind]);
    const onComplete = vi.fn();

    render(
      <AppStateProvider>
        <GenesisFlow onComplete={onComplete} />
      </AppStateProvider>,
    );

    fireEvent.click(screen.getByText('Begin'));
    fireEvent.click(await screen.findByText('Choose template'));
    fireEvent.click(await screen.findByText('Boot complete'));

    expect(api.genesis.createFromTemplate).toHaveBeenCalledWith({
      templateId: 'lucy',
      marketplaceId: undefined,
      basePath: 'C:\\Users\\test\\agents',
    });
    expect(api.genesis.create).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();

    resolveCreate({ success: true, mindId: createdMind.mindId, mindPath: createdMind.mindPath });

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalled();
    });
  });

  it('keeps custom selection on the generated create path', async () => {
    render(
      <AppStateProvider>
        <GenesisFlow onComplete={vi.fn()} />
      </AppStateProvider>,
    );

    fireEvent.click(screen.getByText('Begin'));
    fireEvent.click(screen.getByText('Choose voice'));
    fireEvent.click(await screen.findByText('Choose role'));

    await waitFor(() => {
      expect(api.genesis.create).toHaveBeenCalledWith({
        name: 'Test Agent',
        role: 'Chief of Staff',
        voice: 'Test Agent',
        voiceDescription: 'Test voice',
        basePath: 'C:\\Users\\test\\agents',
      });
    });
    expect(api.genesis.createFromTemplate).not.toHaveBeenCalled();
  });

  it('adds a marketplace from the landing page and refreshes templates', async () => {
    render(
      <AppStateProvider>
        <GenesisFlow onComplete={vi.fn()} />
      </AppStateProvider>,
    );

    fireEvent.click(screen.getByText('Add Marketplace'));

    await waitFor(() => {
      expect(api.marketplace.addGenesisRegistry).toHaveBeenCalledWith('https://github.com/agency-microsoft/genesis-minds');
    });
    expect(api.genesis.listTemplates).toHaveBeenCalled();
  });

  it('shows marketplace template failures and blocks completion', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(vi.fn());
    (api.genesis.createFromTemplate as ReturnType<typeof vi.fn>).mockResolvedValue({ success: false, error: 'marketplace unavailable' });
    const onComplete = vi.fn();

    render(
      <AppStateProvider>
        <GenesisFlow onComplete={onComplete} />
      </AppStateProvider>,
    );

    fireEvent.click(screen.getByText('Begin'));
    fireEvent.click(await screen.findByText('Choose template'));

    expect((await screen.findByRole('alert')).textContent).toBe('marketplace unavailable');

    expect(onComplete).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
