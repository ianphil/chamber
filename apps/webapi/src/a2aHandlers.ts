import type { AgentCard, Message, SendMessageRequest } from '@chamber/shared/a2a-types';
import type { A2AWebApiContext, ChamberRequest, ChamberResponse, RemoteA2AAgentAuth, WebApiLogger } from './types';

export async function healthHandler(): Promise<ChamberResponse> {
  return { status: 200, body: { ok: true } };
}

export async function listA2AAgentsHandler(_request: ChamberRequest, ctx: A2AWebApiContext): Promise<ChamberResponse> {
  return { status: 200, body: { agents: await ctx.listA2AAgents() } };
}

export async function getA2AAgentCardHandler(request: ChamberRequest, ctx: A2AWebApiContext): Promise<ChamberResponse> {
  const recipient = extractA2AAgentRecipient(request.path);
  if (!recipient) return { status: 400, body: { error: 'recipient is required' } };
  const card = await ctx.getA2AAgentCard(recipient);
  if (!card) return { status: 404, body: { error: `A2A agent not found: ${recipient}` } };
  return { status: 200, body: card };
}

export async function registerA2AAgentCardHandler(request: ChamberRequest, ctx: A2AWebApiContext): Promise<ChamberResponse> {
  const body = typeof request.body === 'object' && request.body !== null
    ? request.body as Record<string, unknown>
    : {};
  const card = isAgentCard(body.card) ? body.card : isAgentCard(body) ? body : null;
  if (!card) return { status: 400, body: { error: 'valid agent card is required' } };
  const inboundAuth = isRemoteA2AAgentAuth(body.inboundAuth) ? body.inboundAuth : undefined;
  try {
    await ctx.registerA2AAgentCard(card, inboundAuth);
  } catch (error) {
    return { status: 400, body: { error: error instanceof Error ? error.message : String(error) } };
  }
  return { status: 200, body: { ok: true, agent: card } };
}

export async function unregisterA2AAgentCardHandler(request: ChamberRequest, ctx: A2AWebApiContext): Promise<ChamberResponse> {
  const recipient = extractLastPathSegment(request.path);
  if (!recipient) return { status: 400, body: { error: 'recipient is required' } };
  await ctx.unregisterA2AAgentCard(recipient);
  return { status: 200, body: { ok: true } };
}

export async function sendA2AMessageHandler(
  request: ChamberRequest,
  ctx: A2AWebApiContext,
  options: { exposeInternalErrors?: boolean; logger?: WebApiLogger } = {},
): Promise<ChamberResponse> {
  if (!isSendMessageRequest(request.body)) {
    return { status: 400, body: { error: 'valid A2A SendMessageRequest is required' } };
  }
  try {
    const response = await ctx.sendA2AMessage(request.body, { allowRemoteRecipients: false });
    return { status: 200, headers: { 'content-type': 'application/a2a+json; charset=utf-8' }, body: response };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('Unknown local recipient:')) {
      return { status: 404, body: { error: message } };
    }
    options.logger?.warn('A2A message delivery failed:', error);
    return {
      status: 502,
      body: { error: options.exposeInternalErrors ? message : 'A2A message delivery failed' },
    };
  }
}

function extractLastPathSegment(path: string): string {
  const segment = path.split('/').filter(Boolean).pop();
  return segment ? decodeURIComponent(segment) : '';
}

function extractA2AAgentRecipient(path: string): string {
  const parts = path.split('/').filter(Boolean);
  const cardSuffix = parts.at(-1) === 'card';
  const segment = cardSuffix ? parts.at(-2) : parts.at(-1);
  return segment ? decodeURIComponent(segment) : '';
}

function isAgentCard(value: unknown): value is AgentCard {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const card = value as Record<string, unknown>;
  return (
    typeof card.name === 'string' &&
    typeof card.description === 'string' &&
    typeof card.version === 'string' &&
    Array.isArray(card.supportedInterfaces) &&
    Array.isArray(card.defaultInputModes) &&
    Array.isArray(card.defaultOutputModes) &&
    Array.isArray(card.skills) &&
    typeof card.capabilities === 'object' &&
    card.capabilities !== null
  );
}

function isRemoteA2AAgentAuth(value: unknown): value is RemoteA2AAgentAuth {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const auth = value as Record<string, unknown>;
  return auth.scheme === 'bearer' && typeof auth.token === 'string' && auth.token.trim().length > 0;
}

function isSendMessageRequest(value: unknown): value is SendMessageRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const request = value as Record<string, unknown>;
  return typeof request.recipient === 'string' && isMessage(request.message);
}

function isMessage(value: unknown): value is Message {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const message = value as Record<string, unknown>;
  return (
    typeof message.messageId === 'string' &&
    (message.role === 'user' || message.role === 'agent') &&
    Array.isArray(message.parts)
  );
}
