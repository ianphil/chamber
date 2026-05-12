import { describe, expect, it, vi } from 'vitest';
import type { SquadRoomEvent, SquadSendRequest } from '@chamber/shared/squad-types';
import { FakeSquadBridgeRunner, UnavailableSquadBridgeRunner } from './SquadBridgeRunner';

const request: SquadSendRequest = {
  roomId: 'C:\\src\\cmux',
  repoPath: 'C:\\src\\cmux',
  prompt: 'What should we work on?',
};

describe('SquadBridgeRunner', () => {
  it('reports unavailable runner failures without throwing', async () => {
    const runner = new UnavailableSquadBridgeRunner();

    await expect(runner.send(request, { onEvent: vi.fn() })).resolves.toEqual({
      success: false,
      reason: 'runner-unavailable',
      error: 'Squad messaging runner is not available yet.',
    });
  });

  it('FakeSquadBridgeRunner emits start, delta, and completion events', async () => {
    const events: SquadRoomEvent[] = [];
    const runner = new FakeSquadBridgeRunner(['hello from squad']);

    const result = await runner.send(request, { onEvent: (event) => events.push(event) });

    expect(result).toMatchObject({
      success: true,
      message: {
        roomId: request.roomId,
        role: 'assistant',
        content: 'hello from squad',
        sender: {
          kind: 'squad-coordinator',
        },
      },
    });
    expect(events.map((event) => event.type)).toEqual(['message-start', 'message-delta', 'message-complete']);
  });

  it('FakeSquadBridgeRunner targets addressed agents', async () => {
    const runner = new FakeSquadBridgeRunner(['agent response']);

    const result = await runner.send({ ...request, targetAgentName: 'Shiherlis' }, { onEvent: vi.fn() });

    expect(result).toMatchObject({
      success: true,
      message: {
        sender: {
          kind: 'squad-agent',
          id: 'Shiherlis',
          name: 'Shiherlis',
        },
      },
    });
  });
});
