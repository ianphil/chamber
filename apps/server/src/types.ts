import type { PrivilegedRequest, PrivilegedResponse } from './privileged-protocol';
import type { AgentCard, SendMessageRequest, SendMessageResponse } from '@chamber/shared/a2a-types';
import type { ModelDto, SendChatRequest } from '@chamber/wire-contracts';

export interface ChamberRequest {
  method: string;
  path: string;
  headers: Headers;
  query?: URLSearchParams;
  body?: unknown;
}

export interface ChamberResponse {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface ServerAuthProgress {
  step: string;
  userCode?: string;
  verificationUri?: string;
  login?: string;
  error?: string;
}

export interface ServerAuthLoginResult {
  success: boolean;
  login?: string;
  error?: string;
}

/**
 * Capabilities the loopback server requires from its host process. Every
 * field except `publish` is mandatory: a deployment that doesn't want to
 * support a feature must provide an explicit refusal (e.g. a function that
 * throws `new Error('Mind loading is unavailable')`) rather than rely on a
 * silent default. `publish` is the optional outbound observability hook the
 * websocket fan-out also tees published chat events into.
 */
export interface ChamberCtx {
  token: string;
  allowedOrigins: ReadonlySet<string>;
  listMinds: () => unknown[];
  addMind: (mindPath: string) => unknown | Promise<unknown>;
  getConfig: () => unknown | Promise<unknown>;
  listLensViews: () => unknown | Promise<unknown>;
  getGenesisStatus: () => unknown | Promise<unknown>;
  getAuthStatus: () => unknown | Promise<unknown>;
  listAuthAccounts: () => unknown[] | Promise<unknown[]>;
  startAuthLogin: (onProgress: (progress: ServerAuthProgress) => void) => Promise<ServerAuthLoginResult>;
  switchAuthAccount: (login: string) => void | Promise<void>;
  logoutAuth: () => void | Promise<void>;
  listChamberTools: () => unknown;
  saveAttachment: (attachment: { name: string; body: ArrayBuffer }) => Promise<unknown>;
  cancelChat: (mindId: string, messageId: string) => Promise<void> | void;
  sendChat: (request: SendChatRequest) => Promise<void> | void;
  newConversation: (mindId: string) => Promise<unknown> | unknown;
  listModels: (mindId?: string) => ModelDto[] | Promise<ModelDto[]>;
  shutdown: () => void;
  handlePrivilegedRequest: (request: PrivilegedRequest) => Promise<PrivilegedResponse>;
  publish?: (sessionId: string, event: unknown) => void;
  listA2AAgents: () => AgentCard[] | Promise<AgentCard[]>;
  getA2AAgentCard: (recipient: string) => AgentCard | null | Promise<AgentCard | null>;
  registerA2AAgentCard: (card: AgentCard) => void | Promise<void>;
  unregisterA2AAgentCard: (recipient: string) => void | Promise<void>;
  sendA2AMessage: (
    request: SendMessageRequest,
    options?: { allowRemoteRecipients?: boolean },
  ) => SendMessageResponse | Promise<SendMessageResponse>;
}
