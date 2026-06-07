/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OrchestrationDiagram } from './OrchestrationDiagram';
import type { MindContext } from '@chamber/shared/types';
import type { TaskLedgerItem } from '@chamber/shared/chatroom-types';

const MIND_A: MindContext = {
  mindId: 'mind-a',
  mindPath: 'C:\\agents\\a',
  identity: { name: 'The Dude', systemMessage: '' },
  status: 'ready',
};
const MIND_B: MindContext = {
  mindId: 'mind-b',
  mindPath: 'C:\\agents\\b',
  identity: { name: 'Jarvis', systemMessage: '' },
  status: 'ready',
};
const MIND_C: MindContext = {
  mindId: 'mind-c',
  mindPath: 'C:\\agents\\c',
  identity: { name: 'Hal', systemMessage: '' },
  status: 'ready',
};

function renderDiagram(overrides?: Partial<Parameters<typeof OrchestrationDiagram>[0]>) {
  const props: Parameters<typeof OrchestrationDiagram>[0] = {
    mode: 'concurrent',
    minds: [MIND_A, MIND_B, MIND_C],
    profileByMindId: {},
    streamingByMind: {},
    activeSpeaker: null,
    disabledMindIds: [],
    groupChatConfig: null,
    handoffConfig: null,
    magneticConfig: null,
    taskLedger: [],
    ...overrides,
  };
  return render(<OrchestrationDiagram {...props} />);
}

describe('OrchestrationDiagram', () => {
  it('renders nothing when there are no minds', () => {
    const { container } = renderDiagram({ minds: [] });
    expect(container.firstChild).toBeNull();
  });

  it('tags the rendered diagram with its mode for each orchestration type', () => {
    for (const mode of ['concurrent', 'sequential', 'group-chat', 'handoff', 'magentic'] as const) {
      const { unmount } = renderDiagram({ mode });
      expect(screen.getByTestId('orchestration-diagram').getAttribute('data-mode')).toBe(mode);
      unmount();
    }
  });

  it('shows the parallel caption for concurrent while any agent streams', () => {
    renderDiagram({ mode: 'concurrent', streamingByMind: { 'mind-a': true } });
    expect(screen.getByText('All agents are responding in parallel.')).toBeTruthy();
  });

  it('names the active speaker in sequential mode', () => {
    renderDiagram({
      mode: 'sequential',
      activeSpeaker: { mindId: 'mind-b', mindName: 'Jarvis', phase: 'speaking' },
      streamingByMind: { 'mind-b': true },
    });
    expect(screen.getByText('Jarvis is responding.')).toBeTruthy();
  });

  it('shows the moderator choosing a speaker in group-chat mode', () => {
    renderDiagram({
      mode: 'group-chat',
      groupChatConfig: { moderatorMindId: 'mind-a', maxTurns: 10, minRounds: 1, maxSpeakerRepeats: 3 },
      activeSpeaker: { mindId: 'mind-a', mindName: 'The Dude', phase: 'moderating' },
      streamingByMind: { 'mind-a': true },
    });
    expect(screen.getByText('The Dude is choosing the next speaker.')).toBeTruthy();
  });

  it('reports the baton holder in handoff mode', () => {
    renderDiagram({
      mode: 'handoff',
      handoffConfig: { initialMindId: 'mind-b', maxHandoffHops: 5 },
    });
    expect(screen.getByText('Baton with Jarvis.')).toBeTruthy();
  });

  it('anchors exactly one baton on the current holder and invents no completed agents', () => {
    const { container } = renderDiagram({
      mode: 'handoff',
      handoffConfig: { initialMindId: 'mind-b', maxHandoffHops: 5 },
    });
    expect(container.querySelectorAll('[title="Holds the baton"]')).toHaveLength(1);
  });

  it('names the responding holder while it streams in handoff mode', () => {
    renderDiagram({
      mode: 'handoff',
      handoffConfig: { initialMindId: 'mind-b', maxHandoffHops: 5 },
      activeSpeaker: { mindId: 'mind-c', mindName: 'Hal', phase: 'speaking' },
      streamingByMind: { 'mind-c': true },
    });
    expect(screen.getByText('Hal is responding.')).toBeTruthy();
  });

  it('renders every agent when the team grows past the compact threshold', () => {
    const many: MindContext[] = Array.from({ length: 8 }, (_, i) => ({
      mindId: `mind-${i}`,
      mindPath: `C:\\agents\\${i}`,
      identity: { name: `Agent ${i}`, systemMessage: '' },
      status: 'ready',
    }));
    renderDiagram({ mode: 'concurrent', minds: many });
    for (let i = 0; i < 8; i++) {
      expect(screen.getAllByText(`Agent ${i}`).length).toBeGreaterThanOrEqual(1);
    }
  });

  it('omits disabled agents from the diagram instead of graying them out', () => {
    renderDiagram({ mode: 'concurrent', disabledMindIds: ['mind-b'] });
    expect(screen.queryByText('Jarvis')).toBeNull();
    expect(screen.getByText('The Dude')).toBeTruthy();
    expect(screen.getByText('Hal')).toBeTruthy();
  });

  it('renders nothing when every agent is disabled', () => {
    const { container } = renderDiagram({
      mode: 'concurrent',
      disabledMindIds: ['mind-a', 'mind-b', 'mind-c'],
    });
    expect(container.firstChild).toBeNull();
  });

  it('falls back to an active agent when the configured moderator is disabled', () => {
    renderDiagram({
      mode: 'group-chat',
      groupChatConfig: { moderatorMindId: 'mind-a', maxTurns: 10, minRounds: 1, maxSpeakerRepeats: 3 },
      disabledMindIds: ['mind-a'],
    });
    expect(screen.queryByText('The Dude')).toBeNull();
    expect(screen.getByText('Jarvis')).toBeTruthy();
  });

  it('reports task progress in magentic mode', () => {
    const ledger: TaskLedgerItem[] = [
      { id: 't1', description: 'do a', assignee: 'mind-b', status: 'completed' },
      { id: 't2', description: 'do b', assignee: 'mind-c', status: 'in-progress' },
    ];
    renderDiagram({
      mode: 'magentic',
      magneticConfig: { managerMindId: 'mind-a', maxSteps: 10 },
      taskLedger: ledger,
    });
    expect(screen.getByText('1/2 tasks complete.')).toBeTruthy();
  });
});
