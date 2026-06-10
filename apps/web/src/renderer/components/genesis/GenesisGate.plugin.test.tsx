/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ChamberRendererPlugin, OnboardingProps } from '@chamber/plugin-api';
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
});
