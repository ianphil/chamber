/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AgentWelcome } from './AgentWelcome';
import { AppStateProvider } from '../../lib/store';
import { installElectronAPI } from '../../../test/helpers';
import type { MindContext } from '@chamber/shared/types';

const mind: MindContext = {
  mindId: 'mind-1',
  mindPath: 'C:\\agents\\moneypenny',
  identity: { name: 'Moneypenny', systemMessage: '# Moneypenny' },
  status: 'ready',
};

function renderWelcome(onPickPrompt = vi.fn()) {
  render(
    <AppStateProvider>
      <AgentWelcome mind={mind} onPickPrompt={onPickPrompt} />
    </AppStateProvider>,
  );
  return onPickPrompt;
}

describe('AgentWelcome', () => {
  beforeEach(() => {
    installElectronAPI();
  });

  it('greets with the agent name and the help prompt', () => {
    renderWelcome();
    expect(screen.getByText('Moneypenny')).toBeTruthy();
    expect(screen.getByText('How can I help you today?')).toBeTruthy();
  });

  it('renders exactly three starter prompts', () => {
    renderWelcome();
    expect(screen.getAllByRole('button')).toHaveLength(3);
  });

  it('stages a starter prompt via onPickPrompt instead of sending', () => {
    const onPickPrompt = renderWelcome();
    fireEvent.click(screen.getByText('Daily briefing'));
    expect(onPickPrompt).toHaveBeenCalledWith('Give me my daily report');
  });
});
