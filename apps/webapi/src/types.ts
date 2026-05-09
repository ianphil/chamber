import type { Server } from 'node:http';
import type { AgentCard, SendMessageRequest, SendMessageResponse } from '@chamber/shared/a2a-types';

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

export interface RemoteA2AAgentAuth {
  scheme: 'bearer';
  token: string;
}

export interface A2AWebApiContext {
  token: string;
  allowedOrigins: ReadonlySet<string>;
  listA2AAgents: () => AgentCard[] | Promise<AgentCard[]>;
  getA2AAgentCard: (recipient: string) => AgentCard | null | Promise<AgentCard | null>;
  registerA2AAgentCard: (card: AgentCard, auth?: RemoteA2AAgentAuth) => void | Promise<void>;
  unregisterA2AAgentCard: (recipient: string) => void | Promise<void>;
  sendA2AMessage: (
    request: SendMessageRequest,
    options?: { allowRemoteRecipients?: boolean },
  ) => SendMessageResponse | Promise<SendMessageResponse>;
}

export interface WebApiLogger {
  warn: (message: string, error?: unknown) => void;
}

export interface A2AWebApiOptions {
  maxBodyBytes?: number;
  exposeInternalErrors?: boolean;
  logger?: WebApiLogger;
}

export interface WebApiServerControls {
  server: Server;
}
