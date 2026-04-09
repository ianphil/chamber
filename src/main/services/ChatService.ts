// Chat session management — creates SDK sessions, streams all events via single callback.
// Adapted from cmux's CopilotService pattern.

import { getSharedClient } from './SdkLoader';
import type { ExtensionLoader } from './ExtensionLoader';
import type { ChatEvent, ModelInfo } from '../../shared/types';
import * as fs from 'fs';
import * as path from 'path';

const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

type CopilotSessionType = import('@github/copilot-sdk').CopilotSession;

export class ChatService {
  private sessions: Map<string, CopilotSessionType> = new Map();
  private abortControllers: Map<string, AbortController> = new Map();
  private mindPath: string | null = null;
  private extensionLoader: ExtensionLoader | null = null;

  setMindPath(mindPath: string): void {
    this.mindPath = mindPath;
  }

  getMindPath(): string | null {
    return this.mindPath;
  }

  setExtensionLoader(loader: ExtensionLoader): void {
    this.extensionLoader = loader;
  }

  getExtensionLoader(): ExtensionLoader | null {
    return this.extensionLoader;
  }

  /** Load SOUL.md + agent files into a single identity string for systemMessage */
  private loadIdentity(): string | null {
    if (!this.mindPath) return null;
    const parts: string[] = [];

    // 1. SOUL.md
    try {
      const soulPath = path.join(this.mindPath, 'SOUL.md');
      if (fs.existsSync(soulPath)) {
        parts.push(fs.readFileSync(soulPath, 'utf-8'));
      }
    } catch { /* missing */ }

    // 2. .github/agents/*.agent.md (strip YAML frontmatter)
    try {
      const agentsDir = path.join(this.mindPath, '.github', 'agents');
      if (fs.existsSync(agentsDir)) {
        const files = fs.readdirSync(agentsDir)
          .filter(f => f.endsWith('.agent.md'))
          .sort();
        for (const file of files) {
          const content = fs.readFileSync(path.join(agentsDir, file), 'utf-8');
          parts.push(content.replace(FRONTMATTER_RE, '').trim());
        }
      }
    } catch { /* missing */ }

    if (parts.length === 0) return null;
    const identity = parts.join('\n\n---\n\n');
    console.log(`[ChatService] Loaded identity (${identity.length} chars)`);
    return identity;
  }

  private async getOrCreateSession(conversationId: string, model?: string): Promise<CopilotSessionType> {
    let session = this.sessions.get(conversationId);
    if (!session) {
      console.log('[ChatService] No existing session, creating new one');
      console.log('[ChatService] Mind path:', this.mindPath);
      const client = await getSharedClient();
      console.log('[ChatService] Got shared client');
      const config: Record<string, unknown> = {
        streaming: true,
      };

      if (model) {
        config.model = model;
        console.log('[ChatService] Using model:', model);
      }

      if (this.mindPath) {
        config.workingDirectory = this.mindPath;

        // Inject SOUL.md + agent instructions as system message
        const identity = this.loadIdentity();
        if (identity) {
          config.systemMessage = { mode: 'append', content: identity };
        }

        if (this.extensionLoader) {
          try {
            const tools = await this.extensionLoader.loadTools(this.mindPath);
            if (tools.length > 0) {
              config.tools = tools;
              console.log(`[ChatService] Loaded ${tools.length} extension tool(s)`);
            }
          } catch (err) {
            console.error('[ChatService] Failed to load extension tools:', err);
          }
        }
      }

      config.onPermissionRequest = async (request: { kind: string }) => {
        return { kind: 'approved' };
      };

      config.onUserInputRequest = async (request: { question: string }) => {
        return { answer: 'Not available in this context', wasFreeform: true };
      };

      console.log('[ChatService] Creating session with config:', Object.keys(config));
      session = await client.createSession(
        config as unknown as Parameters<typeof client.createSession>[0]
      );
      console.log('[ChatService] Session created successfully');
      this.sessions.set(conversationId, session);
    }
    return session;
  }

  async sendMessage(
    conversationId: string,
    prompt: string,
    messageId: string,
    emit: (event: ChatEvent) => void,
    model?: string,
  ): Promise<void> {
    const abortController = new AbortController();
    this.abortControllers.set(conversationId, abortController);

    const unsubs: (() => void)[] = [];
    const guard = (fn: () => void) => { if (!abortController.signal.aborted) fn(); };

    try {
      console.log('[ChatService] Creating/getting session for', conversationId);
      const session = await this.getOrCreateSession(conversationId, model);
      console.log('[ChatService] Session ready, sending prompt');

      // Text streaming
      unsubs.push(session.on('assistant.message_delta', (event) => {
        guard(() => emit({
          type: 'chunk',
          sdkMessageId: event.data.messageId,
          content: event.data.deltaContent,
        }));
      }));

      // Final assistant message (reconciliation / no-delta fallback)
      unsubs.push(session.on('assistant.message', (event) => {
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
      unsubs.push(session.on('assistant.reasoning_delta', (event) => {
        guard(() => emit({
          type: 'reasoning',
          reasoningId: event.data.reasoningId,
          content: event.data.deltaContent,
        }));
      }));

      // Tool execution
      unsubs.push(session.on('tool.execution_start', (event) => {
        guard(() => emit({
          type: 'tool_start',
          toolCallId: event.data.toolCallId,
          toolName: event.data.toolName,
          args: event.data.arguments as Record<string, unknown> | undefined,
          parentToolCallId: event.data.parentToolCallId,
        }));
      }));

      unsubs.push(session.on('tool.execution_progress', (event) => {
        guard(() => emit({
          type: 'tool_progress',
          toolCallId: event.data.toolCallId,
          message: event.data.progressMessage,
        }));
      }));

      unsubs.push(session.on('tool.execution_partial_result', (event) => {
        guard(() => emit({
          type: 'tool_output',
          toolCallId: event.data.toolCallId,
          output: event.data.partialOutput,
        }));
      }));

      unsubs.push(session.on('tool.execution_complete', (event) => {
        guard(() => emit({
          type: 'tool_done',
          toolCallId: event.data.toolCallId,
          success: event.data.success,
          result: event.data.result?.content,
          error: event.data.error?.message,
        }));
      }));

      // Log all events for debugging
      unsubs.push(session.on((event) => {
        console.log('[ChatService] Event:', event.type, JSON.stringify(event.data ?? {}).slice(0, 200));
      }));

      console.log('[ChatService] Calling send...');
      await session.send({ prompt });

      // Wait for session.idle to signal completion
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          resolve(); // 5 min safety timeout
        }, 300_000);

        const unsubIdle = session.on('session.idle', () => {
          clearTimeout(timeout);
          unsubIdle();
          resolve();
        });
        unsubs.push(unsubIdle);

        const unsubError = session.on('session.error', (event) => {
          clearTimeout(timeout);
          unsubError();
          reject(new Error(event.data.message));
        });
        unsubs.push(unsubError);

        // If aborted externally, resolve immediately
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
      this.abortControllers.delete(conversationId);
    }
  }

  async cancelMessage(
    conversationId: string,
    messageId: string,
    onDone: (messageId: string) => void,
  ): Promise<void> {
    const controller = this.abortControllers.get(conversationId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(conversationId);
    }
    const session = this.sessions.get(conversationId);
    if (session) {
      await session.abort().catch(() => {});
    }
    onDone(messageId);
  }

  getAbortController(conversationId: string): AbortController | undefined {
    return this.abortControllers.get(conversationId);
  }

  async destroySession(conversationId: string): Promise<void> {
    const session = this.sessions.get(conversationId);
    if (session) {
      await session.destroy().catch(() => {});
      this.sessions.delete(conversationId);
    }
    if (this.extensionLoader) {
      await this.extensionLoader.cleanup();
    }
  }

  async sendBackgroundPrompt(prompt: string): Promise<void> {
    const bgConversationId = `bg-${Date.now()}`;
    try {
      const session = await this.getOrCreateSession(bgConversationId);
      await session.send({ prompt });

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(resolve, 120_000);
        const unsubIdle = session.on('session.idle', () => {
          clearTimeout(timeout);
          unsubIdle();
          resolve();
        });
        const unsubError = session.on('session.error', (event) => {
          clearTimeout(timeout);
          unsubError();
          reject(new Error(event.data.message));
        });
      });
    } finally {
      await this.destroySession(bgConversationId);
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    try {
      const client = await getSharedClient();
      const models = await client.listModels();
      return models.map((m: { id: string; name: string }) => ({ id: m.id, name: m.name }));
    } catch (err) {
      console.error('[ChatService] Failed to list models:', err);
      return [];
    }
  }

  async stop(): Promise<void> {
    for (const [, session] of this.sessions) {
      await session.destroy().catch(() => {});
    }
    this.sessions.clear();
    this.abortControllers.clear();
    if (this.extensionLoader) {
      await this.extensionLoader.cleanup();
    }
  }
}
