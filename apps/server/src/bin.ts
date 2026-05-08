import { createHttpServer } from './honoAdapter';
import { createServerContext } from './composition';
import { Logger } from '@chamber/services';

const log = Logger.create('server');
import {
  AuthService,
  ChatService,
  ConfigService,
  CopilotClientFactory,
  getChamberToolsBinDir,
  IdentityLoader,
  MindManager,
  TurnQueue,
  ViewDiscovery,
  type CredentialStore,
} from '@chamber/services';
import keytar from 'keytar';
import path from 'node:path';
import { createCredentialPrivilegedHandler } from './privileged-protocol';
import type { ChamberCtx } from './types';

const port = Number(process.env.CHAMBER_SERVER_PORT ?? 0);
const allowedOrigin = process.env.CHAMBER_ALLOWED_ORIGIN ?? 'http://127.0.0.1';

const configService = new ConfigService();
const saveActiveLogin = (login: string | null) => {
  const config = configService.load();
  configService.save({ ...config, activeLogin: login });
};
const authService = new AuthService(keytar as CredentialStore, () => configService.load().activeLogin, saveActiveLogin);
const viewDiscovery = new ViewDiscovery();
const mindManager = new MindManager(
  new CopilotClientFactory({ toolsBinDir: getChamberToolsBinDir() }),
  new IdentityLoader(() => configService.load().installedTools ?? []),
  configService,
  viewDiscovery,
);
const chatService = new ChatService(mindManager, new TurnQueue());
viewDiscovery.setRefreshHandler({
  sendBackgroundPrompt: (mindPath, prompt) => mindManager.sendBackgroundPrompt(mindPath, prompt),
});

// Surfaces the loopback server intentionally does not yet implement. Throwing
// stubs (instead of silent {}/null defaults) honor the `ChamberCtx` contract:
// a deployment that doesn't support a feature must say so explicitly. Wiring
// these to real services is tracked as follow-up work; failing fast is the
// honest interim behavior.
function notImplemented(name: string): () => never {
  return () => {
    throw new Error(`Loopback server: ${name} is not implemented`);
  };
}

// `ctx.sendChat` needs to call `serverControls.publish`, but `serverControls`
// is built from `ctx`. Break the cycle with a holder that the late-bound
// publish method overwrites once `createHttpServer` returns. The ctx itself
// stays immutable after construction. Future cleanup: extract a `ChatEventBus`
// port owned by the composition root so neither side has to mutate.
const publishHolder: { publish: (sessionId: string, event: unknown) => void } = {
  publish: () => {},
};

const productionContext: ChamberCtx = createServerContext({
  token: process.env.CHAMBER_SERVER_TOKEN,
  allowedOrigins: [allowedOrigin],
  listMinds: () => mindManager.listMinds(),
  addMind: async (mindPath) => {
    const mind = await mindManager.loadMind(mindPath);
    mindManager.setActiveMind(mind.mindId);
    return mind;
  },
  getConfig: () => configService.load(),
  listLensViews: () => viewDiscovery.getViews(),
  getGenesisStatus: notImplemented('getGenesisStatus'),
  getAuthStatus: async () => {
    const credential = await authService.getStoredCredential();
    return { authenticated: credential !== null, login: credential?.login };
  },
  listAuthAccounts: () => authService.listAccounts(),
  startAuthLogin: async (onProgress) => {
    authService.setProgressHandler(onProgress);
    const result = await authService.startLogin();
    if (result.success && result.login) {
      authService.setActiveLogin(result.login);
    }
    return result;
  },
  switchAuthAccount: async (login) => {
    const accounts = await authService.listAccounts();
    if (!accounts.some((account) => account.login === login)) {
      throw new Error(`Account ${login} is not available`);
    }
    authService.setActiveLogin(login);
  },
  logoutAuth: () => authService.logout(),
  listChamberTools: () => configService.load().installedTools ?? [],
  saveAttachment: notImplemented('saveAttachment'),
  sendChat: ({ mindId, message, messageId, model, attachments }) =>
    chatService.sendMessage(
      mindId,
      message,
      messageId,
      (event) => publishHolder.publish(messageId, { mindId, messageId, event }),
      model,
      attachments,
    ),
  newConversation: (mindId) => chatService.newConversation(mindId),
  cancelChat: (mindId, messageId) => chatService.cancelMessage(mindId, messageId),
  listModels: (mindId) => {
    const id = mindId ?? mindManager.getActiveMindId() ?? mindManager.listMinds()[0]?.mindId;
    return id ? chatService.listModels(id) : [];
  },
  shutdown: () => {
    void shutdown();
  },
  handlePrivilegedRequest: createCredentialPrivilegedHandler(keytar as CredentialStore),
});

function buildE2EFakeChatContext(base: ChamberCtx): ChamberCtx {
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

  return {
    ...base,
    listMinds: () => Array.from(fakeMinds.values()),
    addMind: (mindPath) => seedFakeMind(mindPath),
    sendChat: ({ mindId, messageId }) => {
      publishHolder.publish(messageId, {
        mindId,
        messageId,
        event: { type: 'message_final', sdkMessageId: `e2e-${messageId}`, content: fakeReply },
      });
      publishHolder.publish(messageId, {
        mindId,
        messageId,
        event: { type: 'done' },
      });
    },
    newConversation: () => undefined,
    cancelChat: () => undefined,
    listModels: () => [{ id: 'e2e-fake-model', name: 'E2E Fake Model' }],
  };
}

const ctx: ChamberCtx = (process.env.CHAMBER_E2E === '1' && process.env.CHAMBER_E2E_FAKE_CHAT === '1')
  ? buildE2EFakeChatContext(productionContext)
  : productionContext;

const serverControls = createHttpServer(ctx);
publishHolder.publish = serverControls.publish;
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
    log.error('Mind shutdown failed:', error);
  });
  server.close(() => process.exit(0));
}

process.on('SIGTERM', () => {
  void shutdown();
});
process.on('SIGINT', () => {
  void shutdown();
});
