/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceScreen } from './VoiceScreen';
import { installElectronAPI, mockElectronAPI } from '../../../test/helpers';
import type { GenesisMindTemplate } from '@chamber/shared/types';

vi.mock('./TypeWriter', () => ({
  TypeWriter: ({ text, onComplete }: { text: string; onComplete: () => void }) => (
    <button type="button" onClick={onComplete}>{text}</button>
  ),
}));

describe('VoiceScreen', () => {
  let api: ReturnType<typeof mockElectronAPI>;

  beforeEach(() => {
    vi.useFakeTimers();
    api = installElectronAPI();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('keeps long template lists searchable without burying the custom option', () => {
    renderVoiceScreen({ templates: makeTemplates(24) });
    showPicker();

    expect(screen.getByRole('button', { name: /Agent 24/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Someone else/ })).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Search voices'), { target: { value: 'ops 17' } });

    expect(screen.getByRole('button', { name: /Agent 17/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Agent 18/ })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Agent 17' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Someone else/ })).toBeTruthy();
  });

  it('confirms predefined templates from the detail pane', () => {
    const onSelectTemplate = vi.fn();
    const template = makeTemplate(1);
    renderVoiceScreen({ templates: [template], onSelectTemplate });
    showPicker();

    fireEvent.click(screen.getByRole('button', { name: 'Choose this voice' }));

    expect(screen.getByRole('button', { name: 'Waking this voice...' })).toBeTruthy();
    act(() => vi.advanceTimersByTime(399));
    expect(onSelectTemplate).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(onSelectTemplate).toHaveBeenCalledWith(template);
  });

  it('prepares a custom Someone else research brief before continuing', async () => {
    let resolveDefaultPath: (value: string) => void = () => {};
    (api.genesis.getDefaultPath as ReturnType<typeof vi.fn>).mockReturnValue(new Promise((resolve) => {
      resolveDefaultPath = resolve;
    }));
    const onSelect = vi.fn();
    renderVoiceScreen({ templates: [makeTemplate(1)], onSelect });
    showPicker();

    fireEvent.click(screen.getByRole('button', { name: /Someone else/ }));
    fireEvent.change(screen.getByLabelText('Who should this feel like?'), { target: { value: 'Moneypenny' } });
    fireEvent.change(screen.getByLabelText('Optional guidance'), { target: { value: 'Connery Bond era' } });
    fireEvent.click(screen.getByRole('button', { name: 'Research this voice' }));

    expect(screen.getByRole('button', { name: 'Preparing...' })).toBeTruthy();
    expect(api.genesis.getDefaultPath).toHaveBeenCalled();

    resolveDefaultPath('C:\\Users\\test\\agents');
    await act(async () => {});
    act(() => vi.advanceTimersByTime(500));

    expect((screen.getByLabelText('Research brief') as HTMLTextAreaElement).value).toContain('Connery Bond era');
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Research brief'), {
      target: { value: 'Refined Tony-style operating brief' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue to purpose' }));

    expect(onSelect).toHaveBeenCalledWith(
      'Moneypenny',
      'Refined Tony-style operating brief',
    );
  });
});

function renderVoiceScreen({
  templates,
  templateError = null,
  onSelect = vi.fn(),
  onSelectTemplate = vi.fn(),
}: {
  templates: GenesisMindTemplate[];
  templateError?: string | null;
  onSelect?: (voice: string, description: string) => void;
  onSelectTemplate?: (template: GenesisMindTemplate) => void;
}) {
  render(
    <VoiceScreen
      templates={templates}
      templateError={templateError}
      onSelect={onSelect}
      onSelectTemplate={onSelectTemplate}
    />,
  );
}

function showPicker() {
  fireEvent.click(screen.getByRole('button', { name: /Choose a voice/ }));
  act(() => vi.advanceTimersByTime(500));
}

function makeTemplates(count: number): GenesisMindTemplate[] {
  return Array.from({ length: count }, (_, index) => makeTemplate(index + 1));
}

function makeTemplate(index: number): GenesisMindTemplate {
  return {
    id: `agent-${index}`,
    displayName: `Agent ${index}`,
    description: `A useful operator for ops ${index}.`,
    role: `Ops ${index}`,
    voice: `Precise, calm, and direct voice ${index}.`,
    templateVersion: '0.1.0',
    agent: '.github/agents/agent.agent.md',
    requiredFiles: ['SOUL.md'],
    source: {
      owner: 'ianphil',
      repo: 'genesis-minds',
      ref: 'master',
      plugin: 'genesis-minds',
      manifestPath: `plugins/genesis-minds/minds/agent-${index}/mind.json`,
      rootPath: `plugins/genesis-minds/minds/agent-${index}`,
    },
  };
}
