/** @vitest-environment jsdom */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AppStateProvider } from '../../lib/store';
import { MessageList } from './MessageList';
import type { ChatMessage, MindContext } from '@chamber/shared/types';
import { installElectronAPI } from '../../../test/helpers';

const Q: MindContext = {
  mindId: 'q',
  mindPath: 'C:\\minds\\q',
  identity: { name: 'Q', systemMessage: 'Quartermaster' },
  status: 'ready',
};

const MONEYPENNY: MindContext = {
  mindId: 'moneypenny',
  mindPath: 'C:\\minds\\moneypenny',
  identity: { name: 'Miss Moneypenny', systemMessage: 'Secretary' },
  status: 'ready',
};

function renderMessages(messages: ChatMessage[]) {
  return render(
    <AppStateProvider
      testInitialState={{
        activeMindId: MONEYPENNY.mindId,
        minds: [Q, MONEYPENNY],
        messagesByMind: { [MONEYPENNY.mindId]: messages },
      }}
    >
      <MessageList />
    </AppStateProvider>,
  );
}

describe('MessageList', () => {
  beforeEach(() => {
    installElectronAPI();
  });

  it('renders A2A user messages with the sending agent attribution', () => {
    renderMessages([
      {
        id: 'a2a-1',
        role: 'user',
        blocks: [{ type: 'text', content: 'Please inspect this file.' }],
        timestamp: 1000,
        sender: { mindId: Q.mindId, name: Q.identity.name },
      },
    ]);

    expect(screen.getAllByText('Q').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('You')).toBeNull();
    expect(screen.getByText('Please inspect this file.')).toBeTruthy();
  });

  it('keeps directly authored user messages attributed to You', () => {
    renderMessages([
      {
        id: 'user-1',
        role: 'user',
        blocks: [{ type: 'text', content: 'Hello directly.' }],
        timestamp: 1000,
      },
    ]);

    expect(screen.getAllByText('You').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Hello directly.')).toBeTruthy();
  });

  it('renders the saved user profile avatar for directly authored messages', async () => {
    const api = installElectronAPI();
    (api.userProfile.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      displayName: 'Ian Philpot',
      work: 'Principal SWE Manager',
      location: 'Atlanta',
      about: '',
      avatarDataUrl: 'data:image/png;base64,aWFu',
      source: 'microsoft',
      microsoftAccount: 'ianphil@microsoft.com',
      updatedAt: '2026-05-09T00:00:00.000Z',
    });

    renderMessages([
      {
        id: 'user-avatar-1',
        role: 'user',
        blocks: [{ type: 'text', content: 'Hello with avatar.' }],
        timestamp: 1000,
      },
    ]);

    await waitFor(() => {
      expect(screen.getByAltText('You avatar')).toHaveProperty('src', 'data:image/png;base64,aWFu');
    });
    expect(screen.getByText('Hello with avatar.')).toBeTruthy();
  });

  it('falls back when an A2A sender name is blank', () => {
    renderMessages([
      {
        id: 'a2a-blank',
        role: 'user',
        blocks: [{ type: 'text', content: 'Blank sender.' }],
        timestamp: 1000,
        sender: { mindId: Q.mindId, name: '   ' },
      },
    ]);

    expect(screen.getAllByText('Unknown Agent').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Blank sender.')).toBeTruthy();
  });

  it('renders the active agent profile avatar for assistant messages', async () => {
    const api = installElectronAPI();
    (api.mindProfile.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      mindId: MONEYPENNY.mindId,
      mindPath: MONEYPENNY.mindPath,
      displayName: 'Moneypenny',
      folderName: 'moneypenny',
      avatarDataUrl: 'data:image/png;base64,bW9uZXlwZW5ueQ==',
      soul: { kind: 'soul', label: 'SOUL.md', relativePath: 'SOUL.md', content: '', exists: true, mtimeMs: 1 },
      agentFiles: [],
      needsRestart: false,
    });

    renderMessages([
      {
        id: 'assistant-1',
        role: 'assistant',
        blocks: [{ type: 'text', content: 'At your service.' }],
        timestamp: 1000,
      },
    ]);

    await waitFor(() => {
      expect(screen.getByAltText('Moneypenny avatar')).toHaveProperty('src', 'data:image/png;base64,bW9uZXlwZW5ueQ==');
    });
    expect(screen.getByText('Moneypenny')).toBeTruthy();
  });
});
