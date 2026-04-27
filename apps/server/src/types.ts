import type { PrivilegedRequest, PrivilegedResponse } from './privileged-protocol';

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

export interface ServerChatAttachment {
  name: string;
  mimeType: string;
  data: string;
}

export interface ServerSendChatRequest {
  mindId: string;
  message: string;
  messageId: string;
  model?: string;
  attachments?: ServerChatAttachment[];
}

export interface ChamberCtx {
  token: string;
  allowedOrigins: ReadonlySet<string>;
  listMinds: () => unknown[];
  addMind?: (mindPath: string) => unknown | Promise<unknown>;
  getConfig?: () => unknown | Promise<unknown>;
  listLensViews?: () => unknown | Promise<unknown>;
  getGenesisStatus?: () => unknown | Promise<unknown>;
  getAuthStatus?: () => unknown | Promise<unknown>;
  listAuthAccounts?: () => unknown[] | Promise<unknown[]>;
  startAuthLogin?: (onProgress: (progress: ServerAuthProgress) => void) => Promise<ServerAuthLoginResult>;
  switchAuthAccount?: (login: string) => void | Promise<void>;
  logoutAuth?: () => void | Promise<void>;
  listChamberTools?: () => unknown;
  publish?: (sessionId: string, event: unknown) => void;
  validatePath?: (candidate: string) => boolean;
  saveAttachment?: (attachment: { name: string; body: ArrayBuffer }) => Promise<unknown>;
  cancelChat?: (sessionId: string) => Promise<void> | void;
  sendChat?: (request: ServerSendChatRequest) => Promise<void> | void;
  newConversation?: (mindId: string) => Promise<void> | void;
  listModels?: (mindId?: string) => unknown[] | Promise<unknown[]>;
  shutdown?: () => void;
  handlePrivilegedRequest?: (request: PrivilegedRequest) => Promise<PrivilegedResponse>;
}
