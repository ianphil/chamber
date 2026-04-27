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
ctx.cancelChat = (messageId) => {
  const mind = mindManager.listMinds().find((candidate) => candidate.mindId === mindManager.getActiveMindId())
    ?? mindManager.listMinds()[0];
  return mind ? chatService.cancelMessage(mind.mindId, messageId) : undefined;
};

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
ctx.shutdown = () => shutdown();
ctx.handlePrivilegedRequest = createCredentialPrivilegedHandler(keytar as CredentialStore);

const serverControls = createHttpServer({
  ...ctx,
  shutdown: () => shutdown(),
});
const { server } = serverControls;

server.listen(port, '127.0.0.1', () => {
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  console.log(JSON.stringify({ type: 'ready', host: '127.0.0.1', port: actualPort, token: ctx.token }));
});

function shutdown(): void {
  server.close(() => process.exit(0));
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
