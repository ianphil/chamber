import { ChamberClient } from '@chamber/client';
import type { ElectronAPI, LensViewManifest, MindContext, ModelInfo } from '@chamber/shared/types';
import type { AgentCard, ListTasksResponse, Task } from '@chamber/shared/a2a-types';
import type { ChatroomAPI, ChatroomMessage, TaskLedgerItem } from '@chamber/shared/chatroom-types';

const noopUnsubscribe = () => undefined;
const SUBSCRIPTION_TIMEOUT_MS = 10_000;

function unavailable(operation: string): never {
  throw new Error(`Not available in browser mode: ${operation}.`);
}

type AuthProgress = Parameters<ElectronAPI['auth']['onProgress']>[0] extends (progress: infer TProgress) => void
  ? TProgress
  : never;

function createClient(): ChamberClient {
  const token = new URLSearchParams(window.location.search).get('token') ?? '';
  return new ChamberClient({ baseUrl: window.location.origin, token, origin: window.location.origin });
}

function createBrowserChatroomApi(): ChatroomAPI {
  return {
    send: async () => unavailable('chatroom send'),
    history: async (): Promise<ChatroomMessage[]> => [],
    taskLedger: async (): Promise<TaskLedgerItem[]> => [],
    clear: async () => unavailable('chatroom clear'),
    stop: async () => unavailable('chatroom stop'),
    setOrchestration: async () => unavailable('chatroom orchestration changes'),
    getOrchestration: async () => ({ mode: 'concurrent', config: null }),
    onEvent: () => noopUnsubscribe,
  };
}

export function installBrowserApi(): void {
  if (window.electronAPI) return;

  const client = createClient();
  const authProgressHandlers = new Set<(progress: AuthProgress) => void>();
  const chatEventHandlers = new Set<Parameters<ElectronAPI['chat']['onEvent']>[0]>();
  const accountSwitchStartedHandlers = new Set<(data: { login: string }) => void>();
  const accountSwitchedHandlers = new Set<(data: { login: string }) => void>();
  const loggedOutHandlers = new Set<() => void>();
  const emitAuthProgress = (progress: AuthProgress) => {
    for (const handler of authProgressHandlers) {
      handler(progress);
    }
  };
  let eventSocket: WebSocket | null = null;
  let openSocketPromise: Promise<WebSocket> | null = null;
  const pendingSubscriptions = new Map<string, {
    resolve: () => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  const openEventSocket = (): Promise<WebSocket> => {
    if (eventSocket?.readyState === WebSocket.OPEN) return Promise.resolve(eventSocket);
    if (openSocketPromise) return openSocketPromise;

    const url = new URL('/events', window.location.origin);
    url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('token', new URLSearchParams(window.location.search).get('token') ?? '');

    openSocketPromise = new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      eventSocket = ws;
      ws.addEventListener('open', () => resolve(ws), { once: true });
      ws.addEventListener('error', () => reject(new Error('Failed to open Chamber event socket.')), { once: true });
      ws.addEventListener('message', (message) => {
        const envelope = JSON.parse(String(message.data)) as { type?: string; payload?: unknown };
        if (envelope.type === 'subscription:ready') {
          const payload = envelope.payload as { sessionId?: string };
          if (payload.sessionId) {
            const pending = pendingSubscriptions.get(payload.sessionId);
            if (pending) {
              clearTimeout(pending.timer);
              pending.resolve();
            }
            pendingSubscriptions.delete(payload.sessionId);
          }
          return;
        }
        if (envelope.type === 'chat:event') {
          const payload = envelope.payload as {
            mindId: string;
            messageId: string;
            event: Parameters<Parameters<ElectronAPI['chat']['onEvent']>[0]>[2];
          };
          for (const handler of chatEventHandlers) {
            handler(payload.mindId, payload.messageId, payload.event);
          }
        }
      });
      ws.addEventListener('close', () => {
        if (eventSocket === ws) eventSocket = null;
        if (openSocketPromise) openSocketPromise = null;
        const error = new Error('Chamber event socket closed before subscription was ready.');
        for (const [sessionId, pending] of pendingSubscriptions) {
          clearTimeout(pending.timer);
          pending.reject(error);
          pendingSubscriptions.delete(sessionId);
        }
      });
    });
    return openSocketPromise;
  };
  const subscribeToChatEvents = async (messageId: string): Promise<void> => {
    const ws = await openEventSocket();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingSubscriptions.delete(messageId);
        reject(new Error('Timed out waiting for Chamber event subscription.'));
      }, SUBSCRIPTION_TIMEOUT_MS);
      pendingSubscriptions.set(messageId, { resolve, reject, timer });
      try {
        ws.send(JSON.stringify({ type: 'subscribe', sessionId: messageId }));
      } catch (error) {
        clearTimeout(timer);
        pendingSubscriptions.delete(messageId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  };
  const api: ElectronAPI = {
    chat: {
      send: async (mindId, message, messageId, model, attachments) => {
        await subscribeToChatEvents(messageId);
        await client.sendChat({ mindId, message, messageId, model, attachments });
      },
      stop: async (mindId, messageId) => {
        await client.cancelChat(mindId, messageId);
      },
      newConversation: async (mindId) => {
        await client.startNewConversation(mindId);
        return { sessionId: '', messages: [], conversations: [] };
      },
      listModels: (): Promise<ModelInfo[]> => client.listModels(),
      onEvent: (callback) => {
        chatEventHandlers.add(callback);
        void openEventSocket();
        return () => {
          chatEventHandlers.delete(callback);
        };
      },
    },
    conversationHistory: {
      list: async () => [],
      resume: async () => ({ sessionId: '', messages: [], conversations: [] }),
      rename: async () => [],
    },
    mind: {
      add: (mindPath): Promise<MindContext> => client.addMind(mindPath) as Promise<MindContext>,
      remove: async () => unavailable('mind removal'),
      list: () => client.listMinds() as Promise<MindContext[]>,
      setActive: async () => unavailable('active mind changes'),
      setModel: async () => null,
      selectDirectory: async () => window.prompt('Enter a local agent folder path on this computer:')?.trim() || null,
      openWindow: async (mindId) => {
        window.open(`/?mindId=${encodeURIComponent(mindId)}`, '_blank', 'noopener,noreferrer');
      },
      onMindChanged: () => noopUnsubscribe,
    },
    lens: {
      getViews: async (): Promise<LensViewManifest[]> => [],
      getViewData: async () => null,
      refreshView: async () => null,
      sendAction: async () => unavailable('Lens write actions'),
      getCanvasUrl: async () => null,
      onViewsChanged: () => noopUnsubscribe,
    },
    auth: {
      getStatus: () => client.getAuthStatus(),
      listAccounts: () => client.listAuthAccounts(),
      startLogin: async () => {
        const result = await client.startAuthLogin((progress) => {
          emitAuthProgress(progress);
          if (progress.step === 'device_code' && progress.verificationUri) {
            window.open(progress.verificationUri, '_blank', 'noopener,noreferrer');
          }
        });
        if (result.success && result.login) {
          const data = { login: result.login };
          for (const handler of accountSwitchStartedHandlers) handler(data);
          for (const handler of accountSwitchedHandlers) handler(data);
        }
        return result;
      },
      switchAccount: async (login) => {
        await client.switchAuthAccount(login);
        const data = { login };
        for (const handler of accountSwitchStartedHandlers) handler(data);
        for (const handler of accountSwitchedHandlers) handler(data);
      },
      logout: async () => {
        await client.logoutAuth();
        for (const handler of loggedOutHandlers) handler();
      },
      onProgress: (callback) => {
        authProgressHandlers.add(callback);
        return () => {
          authProgressHandlers.delete(callback);
        };
      },
      onAccountSwitchStarted: (callback) => {
        accountSwitchStartedHandlers.add(callback);
        return () => {
          accountSwitchStartedHandlers.delete(callback);
        };
      },
      onAccountSwitched: (callback) => {
        accountSwitchedHandlers.add(callback);
        return () => {
          accountSwitchedHandlers.delete(callback);
        };
      },
      onLoggedOut: (callback) => {
        loggedOutHandlers.add(callback);
        return () => {
          loggedOutHandlers.delete(callback);
        };
      },
    },
    genesis: {
      getDefaultPath: async () => '',
      pickPath: async () => null,
      listTemplates: async () => [],
      create: async () => ({ success: false, error: 'Genesis setup is desktop-only in browser mode.' }),
      createFromTemplate: async () => ({ success: false, error: 'Genesis template install is desktop-only in browser mode.' }),
      onProgress: () => noopUnsubscribe,
    },
    marketplace: {
      listGenesisRegistries: async () => [],
      addGenesisRegistry: async () => ({ success: false, error: 'Marketplace management is desktop-only in browser mode.' }),
      refreshGenesisRegistry: async () => ({ success: false, error: 'Marketplace management is desktop-only in browser mode.' }),
      setGenesisRegistryEnabled: async () => ({ success: false, error: 'Marketplace management is desktop-only in browser mode.' }),
      removeGenesisRegistry: async () => ({ success: false, error: 'Marketplace management is desktop-only in browser mode.' }),
    },
    chatroom: createBrowserChatroomApi(),
    updater: {
      getState: async () => ({
        enabled: false,
        status: 'disabled',
        currentVersion: 'browser',
        downloadPercent: null,
        message: 'Desktop updates are unavailable in browser mode.',
        canRetry: false,
      }),
      check: async () => ({ success: false, message: 'Desktop updates are unavailable in browser mode.' }),
      download: async () => ({ success: false, message: 'Desktop updates are unavailable in browser mode.' }),
      installAndRestart: async () => ({ success: false, message: 'Desktop updates are unavailable in browser mode.' }),
      onStateChanged: () => noopUnsubscribe,
    },
    a2a: {
      onIncoming: () => noopUnsubscribe,
      listAgents: async (): Promise<AgentCard[]> => [],
      onTaskStatusUpdate: () => noopUnsubscribe,
      onTaskArtifactUpdate: () => noopUnsubscribe,
      getTask: async (): Promise<Task | null> => null,
      listTasks: async (): Promise<ListTasksResponse> => ({ tasks: [], nextPageToken: '', pageSize: 0, totalSize: 0 }),
      cancelTask: async (taskId) => ({ error: `Task cancellation is unavailable in browser mode: ${taskId}` }),
    },
    window: {
      minimize: () => unavailable('window minimize'),
      maximize: () => unavailable('window maximize'),
      close: () => window.close(),
    },
  };
  window.electronAPI = api;
  if (!window.desktop) {
    window.desktop = {
      pickFolder: api.mind.selectDirectory,
      openMindWindow: api.mind.openWindow,
    };
  }
}
