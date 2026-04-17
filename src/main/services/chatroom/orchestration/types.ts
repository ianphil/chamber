import type { OrchestrationMode, ChatroomStreamEvent, ChatroomMessage } from '../../../../shared/chatroom-types';
import type { MindContext } from '../../../../shared/types';
import type { CopilotSession } from '../../mind';

// ---------------------------------------------------------------------------
// OrchestrationStrategy — implemented by each orchestration mode
// ---------------------------------------------------------------------------

export interface OrchestrationStrategy {
  readonly mode: OrchestrationMode;

  execute(
    userMessage: string,
    participants: MindContext[],
    roundId: string,
    context: OrchestrationContext,
  ): Promise<void>;

  stop(): void;
}

// ---------------------------------------------------------------------------
// OrchestrationContext — adapter provided by ChatroomService to strategies
// ---------------------------------------------------------------------------

export interface OrchestrationContext {
  getOrCreateSession(mindId: string): Promise<CopilotSession>;
  evictSession(mindId: string): void;
  buildBasePrompt(userMessage: string, participants: MindContext[]): string;
  emitEvent(event: ChatroomStreamEvent): void;
  persistMessage(message: ChatroomMessage): void;
  getHistory(): ChatroomMessage[];
  readonly orchestrationMode: OrchestrationMode;
}
