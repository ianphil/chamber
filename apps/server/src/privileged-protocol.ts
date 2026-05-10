import type { CredentialStore } from '@chamber/services';

export const PRIVILEGED_PROTO_VERSION = 1;

export type PrivilegedRequest =
  | {
      protoVersion: typeof PRIVILEGED_PROTO_VERSION;
      type: 'credential.findCredentials';
      requestId: string;
      payload: { service: string };
    }
  | {
      protoVersion: typeof PRIVILEGED_PROTO_VERSION;
      type: 'credential.setPassword';
      requestId: string;
      payload: { service: string; account: string; password: string };
    }
  | {
      protoVersion: typeof PRIVILEGED_PROTO_VERSION;
      type: 'credential.deletePassword';
      requestId: string;
      payload: { service: string; account: string };
    };

export type PrivilegedResponse =
  | {
      ok: true;
      requestId: string;
      credentials: Array<{ account: string; password: string }>;
    }
  | {
      ok: true;
      requestId: string;
    }
  | {
      ok: true;
      requestId: string;
      deleted: boolean;
    };

export class PrivilegedProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PrivilegedProtocolError';
  }
}

export function parsePrivilegedRequest(value: unknown): PrivilegedRequest {
  if (!value || typeof value !== 'object') {
    throw new PrivilegedProtocolError('Privileged request must be an object.');
  }
  const request = value as Record<string, unknown>;
  if (request.protoVersion !== PRIVILEGED_PROTO_VERSION) {
    throw new PrivilegedProtocolError(`Unsupported privileged protocol version: ${String(request.protoVersion)}`);
  }
  if (typeof request.requestId !== 'string' || request.requestId.length === 0) {
    throw new PrivilegedProtocolError('Privileged request requires requestId.');
  }
  if (typeof request.type !== 'string') {
    throw new PrivilegedProtocolError('Privileged request requires type.');
  }
  switch (request.type) {
    case 'credential.findCredentials': {
      const payload = requirePayload(request.payload, request.type);
      return {
        protoVersion: PRIVILEGED_PROTO_VERSION,
        type: request.type,
        requestId: request.requestId,
        payload: {
          service: requireString(payload, 'service', request.type),
        },
      };
    }
    case 'credential.setPassword': {
      const payload = requirePayload(request.payload, request.type);
      return {
        protoVersion: PRIVILEGED_PROTO_VERSION,
        type: request.type,
        requestId: request.requestId,
        payload: {
          service: requireString(payload, 'service', request.type),
          account: requireString(payload, 'account', request.type),
          password: requireString(payload, 'password', request.type),
        },
      };
    }
    case 'credential.deletePassword': {
      const payload = requirePayload(request.payload, request.type);
      return {
        protoVersion: PRIVILEGED_PROTO_VERSION,
        type: request.type,
        requestId: request.requestId,
        payload: {
          service: requireString(payload, 'service', request.type),
          account: requireString(payload, 'account', request.type),
        },
      };
    }
    default:
      throw new PrivilegedProtocolError(`Unsupported privileged request type: ${request.type}`);
  }
}

export function createCredentialPrivilegedHandler(
  credentials: CredentialStore,
): (request: PrivilegedRequest) => Promise<PrivilegedResponse> {
  return async (request) => {
    switch (request.type) {
      case 'credential.findCredentials':
        return {
          ok: true,
          requestId: request.requestId,
          credentials: await credentials.findCredentials(request.payload.service),
        };
      case 'credential.setPassword':
        await credentials.setPassword(
          request.payload.service,
          request.payload.account,
          request.payload.password,
        );
        return { ok: true, requestId: request.requestId };
      case 'credential.deletePassword':
        return {
          ok: true,
          requestId: request.requestId,
          deleted: await credentials.deletePassword(request.payload.service, request.payload.account),
        };
    }
  };
}

function requirePayload(value: unknown, type: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PrivilegedProtocolError(`${type} requires payload.`);
  }
  return value as Record<string, unknown>;
}

function requireString(payload: Record<string, unknown>, field: string, type: string): string {
  const value = payload[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new PrivilegedProtocolError(`${type} requires payload.${field}.`);
  }
  return value;
}
