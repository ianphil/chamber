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

export interface ChamberCtx {
  token: string;
  allowedOrigins: ReadonlySet<string>;
  listMinds: () => unknown[];
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
  shutdown?: () => void;
  handlePrivilegedRequest?: (request: PrivilegedRequest) => Promise<PrivilegedResponse>;
}
