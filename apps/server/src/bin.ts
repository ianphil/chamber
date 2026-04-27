import { createHttpServer } from './honoAdapter';
import { createServerContext } from './composition';
import { AuthService } from '../../../packages/services/src/auth/AuthService';
import type { CredentialStore } from '../../../packages/services/src/ports';
import keytar from 'keytar';
import { createCredentialPrivilegedHandler } from './privileged-protocol';

const port = Number(process.env.CHAMBER_SERVER_PORT ?? 0);
const allowedOrigin = process.env.CHAMBER_ALLOWED_ORIGIN ?? 'http://127.0.0.1';

const ctx = createServerContext({
  token: process.env.CHAMBER_SERVER_TOKEN,
  allowedOrigins: [allowedOrigin],
});
let activeLogin: string | null = null;
const authService = new AuthService(keytar as CredentialStore, () => activeLogin, (login) => {
  activeLogin = login;
});

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

const { server } = createHttpServer({
  ...ctx,
  shutdown: () => shutdown(),
});

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
