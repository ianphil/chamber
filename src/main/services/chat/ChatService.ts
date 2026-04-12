// ChatService — thin message streaming layer.
// Gets sessions from MindManager, streams SDK events via callback.

import type { MindManager } from '../mind/MindManager';
import type { ChatEvent, ModelInfo } from '../../../shared/types';

export class ChatService {
  private abortControllers = new Map<string, AbortController>();

  constructor(private readonly mindManager: MindManager) {}

  async sendMessage(
    mindId: string,
    prompt: string,
    messageId: string,
    emit: (event: ChatEvent) => void,
    model?: string,
  ): Promise<void> {
    const abortController = new AbortController();
    this.abortControllers.set(mindId, abortController);

    const unsubs: (() => void)[] = [];
    const guard = (fn: () => void) => { if (!abortController.signal.aborted) fn(); };

    try {
      const context = this.mindManager.getMind(mindId);
      if (!context?.session) {
        throw new Error(`Mind ${mindId} not found or has no session`);
      }
      const session = context.session;

      // Text streaming
      unsubs.push(session.on('assistant.message_delta', (event: any) => {
        guard(() => emit({
          type: 'chunk',
          sdkMessageId: event.data.messageId,
          content: event.data.deltaContent,
        }));
      }));

      // Final assistant message
      unsubs.push(session.on('assistant.message', (event: any) => {
        guard(() => {
          if (event.data.content) {
            emit({
              type: 'message_final',
              sdkMessageId: event.data.messageId,
              content: event.data.content,
            });
          }
        });
      }));

      // Reasoning
      unsubs.push(session.on('assistant.reasoning_delta', (event: any) => {
        guard(() => emit({
          type: 'reasoning',
          reasoningId: event.data.reasoningId,
          content: event.data.deltaContent,
        }));
      }));

      // Tool execution
      unsubs.push(session.on('tool.execution_start', (event: any) => {
        guard(() => emit({
          type: 'tool_start',
          toolCallId: event.data.toolCallId,
          toolName: event.data.toolName,
          args: event.data.arguments as Record<string, unknown> | undefined,
          parentToolCallId: event.data.parentToolCallId,
        }));
      }));

      unsubs.push(session.on('tool.execution_progress', (event: any) => {
        guard(() => emit({
          type: 'tool_progress',
          toolCallId: event.data.toolCallId,
          message: event.data.progressMessage,
        }));
      }));

      unsubs.push(session.on('tool.execution_partial_result', (event: any) => {
        guard(() => emit({
          type: 'tool_output',
          toolCallId: event.data.toolCallId,
          output: event.data.partialOutput,
        }));
      }));

      unsubs.push(session.on('tool.execution_complete', (event: any) => {
        guard(() => emit({
          type: 'tool_done',
          toolCallId: event.data.toolCallId,
          success: event.data.success,
          result: event.data.result?.content,
          error: event.data.error?.message,
        }));
      }));

      await session.send({ prompt });

      // Wait for idle
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(resolve, 300_000);

        const unsubIdle = session.on('session.idle', () => {
          clearTimeout(timeout);
          unsubIdle();
          resolve();
        });
        unsubs.push(unsubIdle);

        const unsubError = session.on('session.error', (event: any) => {
          clearTimeout(timeout);
          unsubError();
          reject(new Error(event.data.message));
        });
        unsubs.push(unsubError);

        abortController.signal.addEventListener('abort', () => {
          clearTimeout(timeout);
          resolve();
        }, { once: true });
      });

      if (abortController.signal.aborted) return;
      emit({ type: 'done' });
    } catch (err) {
      if (abortController.signal.aborted) return;
      const message = err instanceof Error ? err.message : String(err);
      emit({ type: 'error', message });
    } finally {
      for (const unsub of unsubs) unsub();
      this.abortControllers.delete(mindId);
    }
  }

  async cancelMessage(mindId: string, messageId: string): Promise<void> {
    const controller = this.abortControllers.get(mindId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(mindId);
    }
    const context = this.mindManager.getMind(mindId);
    if (context?.session) {
      await context.session.abort().catch(() => {});
    }
  }

  async newConversation(mindId: string): Promise<void> {
    await this.mindManager.recreateSession(mindId);
  }

  async listModels(mindId: string): Promise<ModelInfo[]> {
    try {
      const context = this.mindManager.getMind(mindId);
      if (!context?.client) return [];
      const models = await context.client.listModels();
      return models.map((m: { id: string; name: string }) => ({ id: m.id, name: m.name }));
    } catch {
      return [];
    }
  }
}
