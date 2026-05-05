/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { TaskLedgerPanel } from './TaskLedgerPanel';
import type { TaskLedgerItem } from '@chamber/shared/chatroom-types';

describe('TaskLedgerPanel', () => {
  const minds = [
    { mindId: 'a', identity: { name: 'Alpha' } },
    { mindId: 'b', identity: { name: 'Beta' } },
  ];

  it('renders nothing when ledger is empty', () => {
    const { container } = render(<TaskLedgerPanel ledger={[]} minds={minds} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders task descriptions', () => {
    const ledger: TaskLedgerItem[] = [
      { id: '1', description: 'Research AI safety', status: 'completed', assignee: 'a' },
      { id: '2', description: 'Write summary', status: 'in-progress', assignee: 'b' },
    ];
    render(<TaskLedgerPanel ledger={ledger} minds={minds} />);
    expect(screen.getByText('Research AI safety')).toBeDefined();
    expect(screen.getByText('Write summary')).toBeDefined();
  });

  it('resolves assignee names from minds', () => {
    const ledger: TaskLedgerItem[] = [
      { id: '1', description: 'Task', status: 'completed', assignee: 'a' },
    ];
    render(<TaskLedgerPanel ledger={ledger} minds={minds} />);
    expect(screen.getByText('Alpha')).toBeDefined();
  });

  it('shows no assignee label for tasks without assignee', () => {
    const ledger: TaskLedgerItem[] = [
      { id: '1', description: 'Pending task', status: 'pending' },
    ];
    render(<TaskLedgerPanel ledger={ledger} minds={minds} />);
    expect(screen.queryByText('Alpha')).toBeNull();
    expect(screen.queryByText('Beta')).toBeNull();
  });

  it('shows status labels for each state', () => {
    const ledger: TaskLedgerItem[] = [
      { id: '1', description: 'Task alpha', status: 'pending' },
      { id: '2', description: 'Task beta', status: 'in-progress' },
      { id: '3', description: 'Task gamma', status: 'completed' },
      { id: '4', description: 'Task delta', status: 'failed' },
    ];
    render(<TaskLedgerPanel ledger={ledger} minds={minds} />);
    expect(screen.getByText('Pending')).toBeDefined();
    expect(screen.getByText('In Progress')).toBeDefined();
    expect(screen.getByText('Done')).toBeDefined();
    expect(screen.getByText('Failed')).toBeDefined();
  });

  it('renders Task Ledger heading', () => {
    const ledger: TaskLedgerItem[] = [{ id: '1', description: 'Task', status: 'pending' }];
    render(<TaskLedgerPanel ledger={ledger} minds={minds} />);
    expect(screen.getByText('Task Ledger')).toBeDefined();
  });
});
