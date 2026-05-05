/** @vitest-environment jsdom */
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AppStateProvider } from '../../lib/store';
import { MessageList } from './MessageList';
import type { ChatMessage, MindContext } from '@chamber/shared/types';

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
});
