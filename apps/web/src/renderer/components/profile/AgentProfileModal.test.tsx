/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentProfileModal } from './AgentProfileModal';
import { AppStateProvider } from '../../lib/store';
import { installElectronAPI, mockElectronAPI } from '../../../test/helpers';
import type { AgentProfile, MindContext } from '@chamber/shared/types';

const mind: MindContext = {
  mindId: 'mind-1',
  mindPath: 'C:\\agents\\moneypenny',
  identity: { name: 'Moneypenny', systemMessage: '# Moneypenny' },
  status: 'ready',
};

describe('AgentProfileModal', () => {
  let api: ReturnType<typeof mockElectronAPI>;

  beforeEach(() => {
    api = installElectronAPI();
    (api.mindProfile.get as ReturnType<typeof vi.fn>).mockResolvedValue(makeProfile());
  });

  afterEach(() => {
    cleanup();
  });

  it('renders profile facts and opens SOUL.md in a focused editor', async () => {
    renderProfileModal();

    expect(await screen.findByText('Moneypenny')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /SOUL.md/ }));

    expect(await screen.findByRole('textbox')).toHaveProperty('value', '# Moneypenny\n\nCalm.');
  });

  it('saves profile files and shows the restart prompt', async () => {
    const updated = makeProfile({ needsRestart: true });
    (api.mindProfile.saveFile as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true, needsRestart: true, profile: updated });
    renderProfileModal();

    fireEvent.click(await screen.findByRole('button', { name: /SOUL.md/ }));
    const editor = await screen.findByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: '# Moneypenny\n\nUpdated.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.mindProfile.saveFile).toHaveBeenCalled());
    expect(await screen.findByRole('button', { name: 'Restart agent to apply' })).toBeTruthy();
  });

  it('renders every local agent markdown file', async () => {
    (api.mindProfile.get as ReturnType<typeof vi.fn>).mockResolvedValue(makeProfile({
      agentFiles: [
        makeAgentFile('moneypenny.agent.md'),
        makeAgentFile('briefing.agent.md'),
      ],
    }));
    renderProfileModal();

    expect(await screen.findByRole('button', { name: /moneypenny\.agent\.md/ })).toBeTruthy();
    expect(await screen.findByRole('button', { name: /briefing\.agent\.md/ })).toBeTruthy();
  });

  it('runs the avatar crop save flow', async () => {
    const source = {
      sourceId: 'source-1',
      dataUrl: 'data:image/png;base64,YXZhdGFy',
      width: 800,
      height: 600,
    };
    (api.mindProfile.pickAvatarImage as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true, source });
    (api.mindProfile.saveAvatar as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true, profile: makeProfile({ avatarDataUrl: source.dataUrl }) });
    renderProfileModal();

    fireEvent.click(await screen.findByRole('button', { name: 'Upload avatar' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save avatar' }));

    await waitFor(() => expect(api.mindProfile.saveAvatar).toHaveBeenCalledWith({
      mindId: 'mind-1',
      sourceId: 'source-1',
      crop: expect.objectContaining({ width: 600, height: 600 }),
    }));
  });
});

function renderProfileModal() {
  render(
    <AppStateProvider>
      <AgentProfileModal mind={mind} open onOpenChange={vi.fn()} />
    </AppStateProvider>,
  );
}

function makeProfile(overrides?: Partial<AgentProfile>): AgentProfile {
  return {
    mindId: 'mind-1',
    mindPath: 'C:\\agents\\moneypenny',
    displayName: 'Moneypenny',
    folderName: 'moneypenny',
    avatarDataUrl: null,
    soul: {
      kind: 'soul',
      label: 'SOUL.md',
      relativePath: 'SOUL.md',
      content: '# Moneypenny\n\nCalm.',
      exists: true,
      mtimeMs: 1,
    },
    agentFiles: [makeAgentFile('moneypenny.agent.md')],
    needsRestart: false,
    ...overrides,
  };
}

function makeAgentFile(label: string) {
  return {
    kind: 'agent' as const,
    label,
    relativePath: `.github\\agents\\${label}`,
    content: '# Agent',
    exists: true,
    mtimeMs: 2,
  };
}
