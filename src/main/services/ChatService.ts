// Chat session management — creates SDK sessions, streams deltas via callbacks.
// Adapted from cmux's CopilotService pattern.

import { getSharedClient } from './SdkLoader';

type CopilotSessionType = import('@github/copilot-sdk').CopilotSession;

export class ChatService {
  private sessions: Map<string, CopilotSessionType> = new Map();
  private abortControllers: Map<string, AbortController> = new Map();
  private mindPath: string | null = null;

  setMindPath(mindPath: string): void {
    this.mindPath = mindPath;
  }

  getMindPath(): string | null {
    return this.mindPath;
  }

  private async getOrCreateSession(conversationId: string): Promise<CopilotSessionType> {
    let session = this.sessions.get(conversationId);
    if (!session) {
      console.log('[ChatService] No existing session, creating new one');
      console.log('[ChatService] Mind path:', this.mindPath);
      const client = await getSharedClient();
      console.log('[ChatService] Got shared client');
      const config: Record<string, unknown> = {};

      if (this.mindPath) {
        config.workingDirectory = this.mindPath;
      }

      // Auto-approve permissions so agent tools don't block
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
    onChunk: (messageId: string, content: string) => void,
    onDone: (messageId: string, fullContent?: string) => void,
    onError: (messageId: string, error: string) => void,
  ): Promise<void> {
    const abortController = new AbortController();
    this.abortControllers.set(conversationId, abortController);

    try {
      console.log('[ChatService] Creating/getting session for', conversationId);
      const session = await this.getOrCreateSession(conversationId);
      console.log('[ChatService] Session ready, sending prompt');
      let receivedChunks = false;

      // Log ALL events for debugging
      const unsubAll = session.on((event) => {
        console.log('[ChatService] Event:', event.type, JSON.stringify(event.data ?? {}).slice(0, 300));
      });

      const unsubDelta = session.on('assistant.message_delta', (event) => {
        if (abortController.signal.aborted) return;
        receivedChunks = true;
        onChunk(messageId, event.data.deltaContent);
      });

      console.log('[ChatService] Calling sendAndWait...');
      const response = await session.sendAndWait(
        { prompt },
        300_000, // 5 min timeout
      );
      console.log('[ChatService] sendAndWait resolved');

      unsubDelta();
      unsubAll();

      if (abortController.signal.aborted) return;

      // Fallback: if no streaming chunks, send full response as one chunk
      if (!receivedChunks && response?.data?.content) {
        onChunk(messageId, response.data.content);
      }

      onDone(messageId);
    } catch (err) {
      if (abortController.signal.aborted) return;
      const message = err instanceof Error ? err.message : String(err);
      onError(messageId, message);
    } finally {
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

  async destroySession(conversationId: string): Promise<void> {
    const session = this.sessions.get(conversationId);
    if (session) {
      await session.destroy().catch(() => {});
      this.sessions.delete(conversationId);
    }
  }

  async stop(): Promise<void> {
    for (const [, session] of this.sessions) {
      await session.destroy().catch(() => {});
    }
    this.sessions.clear();
    this.abortControllers.clear();
  }
}
