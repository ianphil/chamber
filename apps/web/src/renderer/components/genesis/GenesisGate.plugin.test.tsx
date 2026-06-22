/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ChamberRendererPlugin, OnboardingProps, OnboardingMindResult } from '@chamber/plugin-api';
import { GenesisGate } from './GenesisGate';
import { AppStateProvider } from '../../lib/store';
import { ChamberPluginProvider } from '../../lib/plugin/ChamberPluginContext';
import { installElectronAPI } from '../../../test/helpers';

// Replace the built-in Genesis flow with a sentinel so the swap logic is
// observable without driving the real flow's typewriter animations.
vi.mock('./GenesisFlow', () => ({
  GenesisFlow: ({ onComplete }: { onComplete: () => void }) => (
    <button data-testid="default-genesis-flow" onClick={onComplete}>default genesis flow</button>
  ),
}));

function EnterpriseOnboarding({ onComplete }: OnboardingProps) {
  return (
    <button data-testid="enterprise-onboarding" onClick={onComplete}>enterprise onboarding</button>
  );
}

// Onboarding surface that exercises the createMind capability, then completes.
function CreatingOnboarding({ onComplete, createMind }: OnboardingProps) {
  const [result, setResult] = React.useState<string>('');
  return (
    <button
      data-testid="creating-onboarding"
      onClick={async () => {
        const res = await createMind({
          templateId: 'pulse',
          marketplaceId: 'genesis-minds-enterprise',
          seedDocument: '# Onboarding\n\nseed',
        });
        setResult(res.success ? `ok:${res.mindId}` : `err:${res.error}`);
        if (res.success) onComplete();
      }}
    >
      {result || 'create'}
    </button>
  );
}

const firstRunState = { minds: [], mindsChecked: true };

async function startNewAgent() {
  await waitFor(() => {
    expect(screen.getByText('New Agent', { exact: false })).toBeTruthy();
  });
  fireEvent.click(screen.getByText('New Agent', { exact: false }));
}

describe('GenesisGate plugin onboarding', () => {
  beforeEach(() => {
    installElectronAPI();
  });

  it('falls back to the built-in Genesis flow when no plugin onboarding is provided', async () => {
    render(
      <AppStateProvider testInitialState={firstRunState}>
        <GenesisGate><div>App</div></GenesisGate>
      </AppStateProvider>,
    );

    await startNewAgent();

    expect(screen.getByTestId('default-genesis-flow')).toBeTruthy();
    expect(screen.queryByTestId('enterprise-onboarding')).toBeNull();
  });

  it('renders the plugin onboarding in place of the built-in flow when provided', async () => {
    const plugin: ChamberRendererPlugin = { id: 'enterprise', onboarding: EnterpriseOnboarding };

    render(
      <ChamberPluginProvider plugin={plugin}>
        <AppStateProvider testInitialState={firstRunState}>
          <GenesisGate><div>App</div></GenesisGate>
        </AppStateProvider>
      </ChamberPluginProvider>,
    );

    await startNewAgent();

    expect(screen.getByTestId('enterprise-onboarding')).toBeTruthy();
    expect(screen.queryByTestId('default-genesis-flow')).toBeNull();
  });

  it('provides createMind: installs the template, seeds the document, and selects the new mind', async () => {
    const api = installElectronAPI();
    const createdMind = {
      mindId: 'pulse-9999',
      mindPath: 'C:\\agents\\pulse',
      identity: { name: 'Pulse', systemMessage: '# Pulse' },
      status: 'ready' as const,
    };
    (api.genesis.createFromTemplate as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      mindId: createdMind.mindId,
      mindPath: createdMind.mindPath,
    });
    (api.genesis.seedDocument as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true });
    (api.mind.list as ReturnType<typeof vi.fn>).mockResolvedValue([createdMind]);

    const plugin: ChamberRendererPlugin = { id: 'enterprise', onboarding: CreatingOnboarding };

    render(
      <ChamberPluginProvider plugin={plugin}>
        <AppStateProvider testInitialState={firstRunState}>
          <GenesisGate><div>App</div></GenesisGate>
        </AppStateProvider>
      </ChamberPluginProvider>,
    );

    await startNewAgent();
    fireEvent.click(screen.getByTestId('creating-onboarding'));

    await waitFor(() => {
      expect(api.genesis.createFromTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ templateId: 'pulse', marketplaceId: 'genesis-minds-enterprise' }),
      );
    });
    expect(api.genesis.seedDocument).toHaveBeenCalledWith('pulse-9999', '# Onboarding\n\nseed');
    // After a successful create the gate completes and reveals the app.
    await waitFor(() => {
      expect(screen.getByText('App')).toBeTruthy();
    });
  });

  it('returns failure and leaves the gate open when template install fails', async () => {
    const api = installElectronAPI();
    (api.genesis.createFromTemplate as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: false,
      error: 'install failed',
    });

    const captured: OnboardingMindResult[] = [];
    function FailingOnboarding({ onComplete, createMind }: OnboardingProps) {
      return (
        <button
          data-testid="failing-onboarding"
          onClick={async () => {
            const res = await createMind({ templateId: 'pulse' });
            captured.push(res);
            if (res.success) onComplete();
          }}
        >
          create
        </button>
      );
    }
    const plugin: ChamberRendererPlugin = { id: 'enterprise', onboarding: FailingOnboarding };

    render(
      <ChamberPluginProvider plugin={plugin}>
        <AppStateProvider testInitialState={firstRunState}>
          <GenesisGate><div>App</div></GenesisGate>
        </AppStateProvider>
      </ChamberPluginProvider>,
    );

    await startNewAgent();
    fireEvent.click(screen.getByTestId('failing-onboarding'));

    await waitFor(() => {
      expect(captured).toHaveLength(1);
    });
    expect(captured[0]).toMatchObject({ success: false, error: 'install failed' });
    // No mind was created, so the renderer is never synced and the gate stays open.
    expect(api.genesis.seedDocument).not.toHaveBeenCalled();
    expect(api.mind.list).not.toHaveBeenCalled();
    expect(screen.queryByText('App')).toBeNull();
    expect(screen.getByTestId('failing-onboarding')).toBeTruthy();
  });

  it('keeps the new mind and reports a non-fatal seedError when document seeding fails', async () => {
    const api = installElectronAPI();
    const createdMind = {
      mindId: 'pulse-9999',
      mindPath: 'C:\\agents\\pulse',
      identity: { name: 'Pulse', systemMessage: '# Pulse' },
      status: 'ready' as const,
    };
    (api.genesis.createFromTemplate as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      mindId: createdMind.mindId,
      mindPath: createdMind.mindPath,
    });
    (api.genesis.seedDocument as ReturnType<typeof vi.fn>).mockResolvedValue({ success: false, error: 'disk full' });
    (api.mind.list as ReturnType<typeof vi.fn>).mockResolvedValue([createdMind]);

    const captured: OnboardingMindResult[] = [];
    function SeedFailingOnboarding({ onComplete, createMind }: OnboardingProps) {
      return (
        <button
          data-testid="seed-failing-onboarding"
          onClick={async () => {
            const res = await createMind({ templateId: 'pulse', seedDocument: '# Onboarding\n\nseed' });
            captured.push(res);
            if (res.success) onComplete();
          }}
        >
          create
        </button>
      );
    }
    const plugin: ChamberRendererPlugin = { id: 'enterprise', onboarding: SeedFailingOnboarding };

    render(
      <ChamberPluginProvider plugin={plugin}>
        <AppStateProvider testInitialState={firstRunState}>
          <GenesisGate><div>App</div></GenesisGate>
        </AppStateProvider>
      </ChamberPluginProvider>,
    );

    await startNewAgent();
    fireEvent.click(screen.getByTestId('seed-failing-onboarding'));

    // Despite the seed failure the mind is created, the renderer is synced, and
    // onboarding completes; the failure is surfaced as a non-fatal seedError.
    await waitFor(() => {
      expect(screen.getByText('App')).toBeTruthy();
    });
    expect(api.genesis.seedDocument).toHaveBeenCalledWith('pulse-9999', '# Onboarding\n\nseed');
    expect(api.mind.list).toHaveBeenCalled();
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({ success: true, mindId: 'pulse-9999', seedError: 'disk full' });
  });
});
