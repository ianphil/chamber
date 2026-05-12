import type {
  SquadRoomEvent,
  SquadRoomMessage,
  SquadSendRequest,
  SquadSendResult,
} from '@chamber/shared/squad-types';

export interface SquadBridgeCallbacks {
  onEvent: (event: SquadRoomEvent) => void;
}

export interface SquadBridgeRunner {
  send(request: SquadSendRequest, callbacks: SquadBridgeCallbacks): Promise<SquadSendResult>;
  stop(turnId: string): Promise<void>;
}

export class UnavailableSquadBridgeRunner implements SquadBridgeRunner {
  async send(request: SquadSendRequest, callbacks: SquadBridgeCallbacks): Promise<SquadSendResult> {
    void request;
    void callbacks;
    return {
      success: false,
      reason: 'runner-unavailable',
      error: 'Squad messaging runner is not available yet.',
    };
  }

  async stop(): Promise<void> {
    return undefined;
  }
}

export class FakeSquadBridgeRunner implements SquadBridgeRunner {
  private readonly responses: string[];
  private readonly activeTurnIds = new Set<string>();

  constructor(responses: string[] = ['Squad response']) {
    this.responses = [...responses];
  }

  async send(request: SquadSendRequest, callbacks: SquadBridgeCallbacks): Promise<SquadSendResult> {
    const turnId = `turn-${this.activeTurnIds.size + 1}`;
    const message: SquadRoomMessage = {
      id: `message-${turnId}`,
      roomId: request.roomId,
      turnId,
      role: 'assistant',
      sender: {
        kind: request.targetAgentName ? 'squad-agent' : 'squad-coordinator',
        id: request.targetAgentName ?? 'coordinator',
        name: request.targetAgentName ?? 'Squad Coordinator',
      },
      content: '',
      timestamp: Date.now(),
      isStreaming: true,
    };
    const content = this.responses.shift() ?? 'Squad response';

    this.activeTurnIds.add(turnId);
    callbacks.onEvent({ type: 'message-start', message });
    callbacks.onEvent({
      type: 'message-delta',
      roomId: request.roomId,
      turnId,
      messageId: message.id,
      delta: content,
    });
    callbacks.onEvent({
      type: 'message-complete',
      roomId: request.roomId,
      turnId,
      messageId: message.id,
      content,
    });
    this.activeTurnIds.delete(turnId);

    return {
      success: true,
      turnId,
      message: {
        ...message,
        content,
        isStreaming: false,
      },
    };
  }

  async stop(turnId: string): Promise<void> {
    this.activeTurnIds.delete(turnId);
  }
}
