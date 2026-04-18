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
// BaseStrategy — shared lifecycle for strategies that use abort + unsubs
// ---------------------------------------------------------------------------

/**
 * Abstract base that owns the `abortController` / `unsubs` lifecycle
 * shared by Sequential, GroupChat, Handoff, and Magentic strategies.
 * ConcurrentStrategy manages per-agent controllers so it does NOT extend this.
 */
export abstract class BaseStrategy implements OrchestrationStrategy {
  abstract readonly mode: OrchestrationMode;

  protected abortController: AbortController | null = null;
  protected currentUnsubs: (() => void)[] = [];

  abstract execute(
    userMessage: string,
    participants: MindContext[],
    roundId: string,
    context: OrchestrationContext,
  ): Promise<void>;

  /** Start a new round — call at the top of execute() */
  protected begin(): AbortController {
    this.abortController = new AbortController();
    return this.abortController;
  }

  /** Whether the current round has been cancelled */
  protected get isAborted(): boolean {
    return this.abortController?.signal.aborted ?? false;
  }

  stop(): void {
    this.abortController?.abort();
    for (const unsub of this.currentUnsubs) unsub();
    this.currentUnsubs = [];
  }
}

// ---------------------------------------------------------------------------
// OrchestrationContext — adapter provided by ChatroomService to strategies
// ---------------------------------------------------------------------------

export interface OrchestrationContext {
  getOrCreateSession(mindId: string): Promise<CopilotSession>;
  evictSession(mindId: string): void;
  buildBasePrompt(userMessage: string, participants: MindContext[], forMind?: MindContext): string;
  emitEvent(event: ChatroomStreamEvent): void;
  persistMessage(message: ChatroomMessage): void;
  getHistory(): ChatroomMessage[];
  readonly orchestrationMode: OrchestrationMode;
}
