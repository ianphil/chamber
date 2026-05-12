export type SquadRoomStatus = 'unselected' | 'missing' | 'ready' | 'error';

export interface SquadAgentSummary {
  name: string;
  role: string;
  charterPath: string | null;
  status: string | null;
}

export interface SquadRoutingRule {
  workType: string;
  routeTo: string;
  examples: string;
}

export interface SquadDecisionSummary {
  title: string;
  body: string;
}

export interface SquadRoomSnapshot {
  id: string;
  repoPath: string | null;
  repoName: string | null;
  squadPath: string | null;
  status: SquadRoomStatus;
  version: number | null;
  coordinator: SquadAgentSummary | null;
  agents: SquadAgentSummary[];
  routingRules: SquadRoutingRule[];
  decisions: SquadDecisionSummary[];
  directives: string | null;
  sessions: string[];
  lastError: string | null;
}

export type SquadRoomMessageSenderKind =
  | 'user'
  | 'chamber-mind'
  | 'squad-coordinator'
  | 'squad-agent'
  | 'system';

export interface SquadRoomMessageSender {
  kind: SquadRoomMessageSenderKind;
  id: string;
  name: string;
}

export interface SquadRoomMessage {
  id: string;
  roomId: string;
  turnId: string | null;
  role: 'user' | 'assistant' | 'system';
  sender: SquadRoomMessageSender;
  content: string;
  timestamp: number;
  isStreaming?: boolean;
}

export interface SquadRoomTranscript {
  version: 1;
  roomId: string;
  repoPath: string;
  messages: SquadRoomMessage[];
}

export interface SquadSendRequest {
  roomId: string;
  repoPath: string;
  prompt: string;
  targetAgentName?: string;
  requestedBy?: SquadRoomMessageSender;
}

export type SquadSendResult =
  | {
      success: true;
      turnId: string;
      message: SquadRoomMessage;
    }
  | {
      success: false;
      error: string;
      reason:
        | 'desktop-only'
        | 'room-not-ready'
        | 'busy'
        | 'runner-unavailable'
        | 'canceled'
        | 'timeout'
        | 'failed';
    };

export type SquadRoomEvent =
  | {
      type: 'message-start';
      message: SquadRoomMessage;
    }
  | {
      type: 'message-delta';
      roomId: string;
      turnId: string;
      messageId: string;
      delta: string;
    }
  | {
      type: 'message-complete';
      roomId: string;
      turnId: string;
      messageId: string;
      content: string;
    }
  | {
      type: 'error';
      roomId: string;
      turnId: string | null;
      message: string;
    }
  | {
      type: 'canceled';
      roomId: string;
      turnId: string;
    };

export interface SquadAPI {
  selectRepository: () => Promise<SquadRoomSnapshot | null>;
  getRoom: (repoPath?: string | null) => Promise<SquadRoomSnapshot>;
  history: (roomId: string) => Promise<SquadRoomMessage[]>;
  send: (request: SquadSendRequest) => Promise<SquadSendResult>;
  stop: (turnId: string) => Promise<void>;
  clear: (roomId: string) => Promise<void>;
  onEvent: (callback: (event: SquadRoomEvent) => void) => () => void;
}
