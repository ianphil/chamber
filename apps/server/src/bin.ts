import { createHttpServer } from './honoAdapter';
import { createServerContext } from './composition';
import {
  AuthService,
  ChatService,
  ConfigService,
  CopilotClientFactory,
  IdentityLoader,
  MindManager,
  TurnQueue,
  ViewDiscovery,
  type CredentialStore,
} from '@chamber/services';
import keytar from 'keytar';
import path from 'node:path';
import { createCredentialPrivilegedHandler } from './privileged-protocol';

const port = Number(process.env.CHAMBER_SERVER_PORT ?? 0);
const allowedOrigin = process.env.CHAMBER_ALLOWED_ORIGIN ?? 'http://127.0.0.1';

const ctx = createServerContext({
  token: process.env.CHAMBER_SERVER_TOKEN,
  allowedOrigins: [allowedOrigin],
});
const configService = new ConfigService();
const saveActiveLogin = (login: string | null) => {
  const config = configService.load();
  configService.save({ ...config, activeLogin: login });
};
const authService = new AuthService(keytar as CredentialStore, () => configService.load().activeLogin, saveActiveLogin);
const viewDiscovery = new ViewDiscovery();
const mindManager = new MindManager(new CopilotClientFactory(), new IdentityLoader(), configService, viewDiscovery);
const chatService = new ChatService(mindManager, new TurnQueue());
viewDiscovery.setRefreshHandler({
  sendBackgroundPrompt: (mindPath, prompt) => mindManager.sendBackgroundPrompt(mindPath, prompt),
});

ctx.listMinds = () => mindManager.listMinds();
ctx.addMind = async (mindPath) => {
  const mind = await mindManager.loadMind(mindPath);
  mindManager.setActiveMind(mind.mindId);
  return mind;
};
ctx.sendChat = ({ mindId, message, messageId, model, attachments }) =>
  chatService.sendMessage(
    mindId,
    message,
    messageId,
    (event) => serverControls.publish(messageId, { mindId, messageId, event }),
    model,
    attachments,
  );
ctx.newConversation = (mindId) => chatService.newConversation(mindId);
ctx.listModels = (mindId) => {
  const id = mindId ?? mindManager.getActiveMindId() ?? mindManager.listMinds()[0]?.mindId;
  return id ? chatService.listModels(id) : [];
};
ctx.cancelChat = (mindId, messageId) => chatService.cancelMessage(mindId, messageId);

ctx.getAuthStatus = async () => {
  const credential = await authService.getStoredCredential();
  return { authenticated: credential !== null, login: credential?.login };
};
ctx.listAuthAccounts = () => authService.listAccounts();
ctx.startAuthLogin = async (onProgress) => {
  authService.setProgressHandler(onProgress);
  const result = await authService.startLogin();
  if (result.success && result.login) {
    authService.setActiveLogin(result.login);
  }
  return result;
};
ctx.switchAuthAccount = async (login) => {
  const accounts = await authService.listAccounts();
  if (!accounts.some((account) => account.login === login)) {
    throw new Error(`Account ${login} is not available`);
  }
  authService.setActiveLogin(login);
};
ctx.logoutAuth = () => authService.logout();
ctx.shutdown = () => {
  void shutdown();
};
ctx.handlePrivilegedRequest = createCredentialPrivilegedHandler(keytar as CredentialStore);

if (process.env.CHAMBER_E2E === '1' && process.env.CHAMBER_E2E_FAKE_CHAT === '1') {
  const fakeMinds = new Map<string, {
    mindId: string;
    mindPath: string;
    identity: { name: string; systemMessage: string };
    status: 'ready';
  }>();
  const fakeReply = process.env.CHAMBER_E2E_FAKE_CHAT_REPLY ?? 'CHAMBER_BROWSER_LOOPBACK_ACK';

  const seedFakeMind = (mindPath: string) => {
    const existing = fakeMinds.get(mindPath);
    if (existing) return existing;
    const basename = path.basename(mindPath) || 'browser-smoke';
    const mind = {
      mindId: `${basename}-e2e`,
      mindPath,
      identity: {
        name: basename,
        systemMessage: `E2E fake browser mind for ${basename}`,
      },
      status: 'ready' as const,
    };
    fakeMinds.set(mindPath, mind);
    return mind;
  };

  // Pre-seed minds at boot so the renderer's mount-time mind.list() picks
  // them up without the test having to add + reload. Honors a comma-separated
  // CHAMBER_E2E_FAKE_MINDS list of mind paths; the basename becomes the mind
  // name. Paths are treated as opaque labels — they do not need to exist on
  // disk in fake-chat mode.
  const seedList = process.env.CHAMBER_E2E_FAKE_MINDS;
  if (seedList) {
    for (const raw of seedList.split(',')) {
      const trimmed = raw.trim();
      if (trimmed) seedFakeMind(trimmed);
    }
  }

  ctx.listMinds = () => Array.from(fakeMinds.values());
  ctx.addMind = (mindPath) => seedFakeMind(mindPath);
  ctx.sendChat = ({ mindId, messageId }) => {
    serverControls.publish(messageId, {
      mindId,
      messageId,
      event: { type: 'message_final', sdkMessageId: `e2e-${messageId}`, content: fakeReply },
    });
    serverControls.publish(messageId, {
      mindId,
      messageId,
      event: { type: 'done' },
    });
  };
  ctx.newConversation = () => undefined;
  ctx.cancelChat = () => undefined;
  ctx.listModels = () => [{ id: 'e2e-fake-model', name: 'E2E Fake Model' }];
}

const serverControls = createHttpServer({
  ...ctx,
  shutdown: () => {
    void shutdown();
  },
});
const { server } = serverControls;

server.listen(port, '127.0.0.1', () => {
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  console.log(JSON.stringify({ type: 'ready', host: '127.0.0.1', port: actualPort, token: ctx.token }));
});

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await mindManager.shutdown().catch((error: unknown) => {
    console.error('[server] Mind shutdown failed:', error);
  });
  server.close(() => process.exit(0));
}

process.on('SIGTERM', () => {
  void shutdown();
});
process.on('SIGINT', () => {
  void shutdown();
});
