import type { ChamberCtx, ChamberRequest, ChamberResponse } from './types';
import type { AgentCard, Message, SendMessageRequest } from '@chamber/shared/a2a-types';
import type { ChatAttachmentDto, CommandResponse, ListModelsResponse, SendChatRequest } from '@chamber/wire-contracts';

export async function healthHandler(): Promise<ChamberResponse> {
  return { status: 200, body: { ok: true } };
}

export async function listMindsHandler(_request: ChamberRequest, ctx: ChamberCtx): Promise<ChamberResponse> {
  return { status: 200, body: { minds: ctx.listMinds() } };
}

export async function addMindHandler(request: ChamberRequest, ctx: ChamberCtx): Promise<ChamberResponse> {
  const mindPath = typeof request.body === 'object' && request.body !== null && 'mindPath' in request.body
    ? String((request.body as { mindPath: unknown }).mindPath).trim()
    : '';
  if (!mindPath) {
    return { status: 400, body: { error: 'mindPath is required' } };
  }
  try {
    return { status: 200, body: { mind: await ctx.addMind(mindPath) } };
  } catch (error) {
    return { status: 400, body: { error: error instanceof Error ? error.message : String(error) } };
  }
}

export async function getConfigHandler(_request: ChamberRequest, ctx: ChamberCtx): Promise<ChamberResponse> {
  return { status: 200, body: await ctx.getConfig() };
}

export async function listLensViewsHandler(_request: ChamberRequest, ctx: ChamberCtx): Promise<ChamberResponse> {
  return { status: 200, body: { views: await ctx.listLensViews() } };
}

export async function getGenesisStatusHandler(_request: ChamberRequest, ctx: ChamberCtx): Promise<ChamberResponse> {
  return { status: 200, body: await ctx.getGenesisStatus() };
}

export async function getAuthStatusHandler(_request: ChamberRequest, ctx: ChamberCtx): Promise<ChamberResponse> {
  return { status: 200, body: await ctx.getAuthStatus() };
}

export async function listAuthAccountsHandler(_request: ChamberRequest, ctx: ChamberCtx): Promise<ChamberResponse> {
  return { status: 200, body: { accounts: await ctx.listAuthAccounts() } };
}

export async function switchAuthAccountHandler(request: ChamberRequest, ctx: ChamberCtx): Promise<ChamberResponse> {
  const login = typeof request.body === 'object' && request.body !== null && 'login' in request.body
    ? String((request.body as { login: unknown }).login)
    : '';
  if (!login) {
    return { status: 400, body: { error: 'login is required' } };
  }
  await ctx.switchAuthAccount(login);
  return { status: 200, body: { ok: true } };
}

export async function logoutAuthHandler(_request: ChamberRequest, ctx: ChamberCtx): Promise<ChamberResponse> {
  await ctx.logoutAuth();
  return { status: 200, body: { ok: true } };
}

export async function listChamberToolsHandler(_request: ChamberRequest, ctx: ChamberCtx): Promise<ChamberResponse> {
  return { status: 200, body: { tools: ctx.listChamberTools() } };
}

export async function listA2AAgentsHandler(_request: ChamberRequest, ctx: ChamberCtx): Promise<ChamberResponse> {
  if (!ctx.listA2AAgents) return { status: 503, body: { error: 'A2A registry is unavailable' } };
  return { status: 200, body: { agents: await ctx.listA2AAgents() } };
}

export async function getA2AAgentCardHandler(request: ChamberRequest, ctx: ChamberCtx): Promise<ChamberResponse> {
  if (!ctx.getA2AAgentCard) return { status: 503, body: { error: 'A2A registry is unavailable' } };
  const recipient = extractA2AAgentRecipient(request.path);
  if (!recipient) return { status: 400, body: { error: 'recipient is required' } };
  const card = await ctx.getA2AAgentCard(recipient);
  if (!card) return { status: 404, body: { error: `A2A agent not found: ${recipient}` } };
  return { status: 200, body: card };
}

export async function registerA2AAgentCardHandler(request: ChamberRequest, ctx: ChamberCtx): Promise<ChamberResponse> {
  if (!ctx.registerA2AAgentCard) return { status: 503, body: { error: 'A2A registry is unavailable' } };
  const body = typeof request.body === 'object' && request.body !== null
    ? request.body as Record<string, unknown>
    : {};
  const card = isAgentCard(body.card) ? body.card : isAgentCard(body) ? body : null;
  if (!card) return { status: 400, body: { error: 'valid agent card is required' } };
  try {
    await ctx.registerA2AAgentCard(card);
  } catch (error) {
    return { status: 400, body: { error: error instanceof Error ? error.message : String(error) } };
  }
  return { status: 200, body: { ok: true, agent: card } };
}

export async function unregisterA2AAgentCardHandler(request: ChamberRequest, ctx: ChamberCtx): Promise<ChamberResponse> {
  if (!ctx.unregisterA2AAgentCard) return { status: 503, body: { error: 'A2A registry is unavailable' } };
  const recipient = extractLastPathSegment(request.path);
  if (!recipient) return { status: 400, body: { error: 'recipient is required' } };
  await ctx.unregisterA2AAgentCard(recipient);
  return { status: 200, body: { ok: true } };
}

export async function sendA2AMessageHandler(request: ChamberRequest, ctx: ChamberCtx): Promise<ChamberResponse> {
  if (!ctx.sendA2AMessage) return { status: 503, body: { error: 'A2A messaging is unavailable' } };
  if (!isSendMessageRequest(request.body)) {
    return { status: 400, body: { error: 'valid A2A SendMessageRequest is required' } };
  }
  try {
    const response = await ctx.sendA2AMessage(request.body, { allowRemoteRecipients: false });
    return { status: 200, headers: { 'content-type': 'application/a2a+json; charset=utf-8' }, body: response };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.startsWith('Unknown local recipient:') ? 404 : 502;
    return { status, body: { error: message } };
  }
}

export async function uploadAttachmentHandler(request: ChamberRequest, ctx: ChamberCtx): Promise<ChamberResponse> {
  const name = request.query?.get('name')?.trim();
  if (!name) {
    return { status: 400, body: { error: 'Attachment name is required' } };
  }
  if (!request.body || !(request.body instanceof ArrayBuffer)) {
    return { status: 400, body: { error: 'Attachment body is required' } };
  }
  return { status: 200, body: await ctx.saveAttachment({ name, body: request.body }) };
}

export async function cancelChatHandler(request: ChamberRequest, ctx: ChamberCtx): Promise<ChamberResponse> {
  const mindId = typeof request.body === 'object' && request.body !== null && 'mindId' in request.body
    ? String((request.body as { mindId: unknown }).mindId).trim()
    : '';
  const messageId = typeof request.body === 'object' && request.body !== null && 'messageId' in request.body
    ? String((request.body as { messageId: unknown }).messageId).trim()
    : '';
  if (!mindId) return { status: 400, body: { error: 'mindId is required' } };
  if (!messageId) return { status: 400, body: { error: 'messageId is required' } };
  await ctx.cancelChat(mindId, messageId);
  return { status: 200, body: { ok: true } };
}

export async function sendChatHandler(request: ChamberRequest, ctx: ChamberCtx): Promise<ChamberResponse> {
  const body = typeof request.body === 'object' && request.body !== null
    ? request.body as Record<string, unknown>
    : {};
  const mindId = typeof body.mindId === 'string' ? body.mindId.trim() : '';
  const message = typeof body.message === 'string' ? body.message : '';
  const messageId = typeof body.messageId === 'string' ? body.messageId.trim() : '';
  if (!mindId) return { status: 400, body: { error: 'mindId is required' } };
  if (!messageId) return { status: 400, body: { error: 'messageId is required' } };

  const attachments = parseChatAttachments(body.attachments);
  if (attachments === null) {
    return { status: 400, body: { error: 'attachments must be valid chat attachments' } };
  }

  const chatRequest: SendChatRequest = {
    mindId,
    message,
    messageId,
    model: typeof body.model === 'string' ? body.model : undefined,
    attachments,
  };

  await ctx.sendChat(chatRequest);
  return commandResponse();
}

export async function newConversationHandler(request: ChamberRequest, ctx: ChamberCtx): Promise<ChamberResponse> {
  const mindId = typeof request.body === 'object' && request.body !== null && 'mindId' in request.body
    ? String((request.body as { mindId: unknown }).mindId).trim()
    : '';
  if (!mindId) return { status: 400, body: { error: 'mindId is required' } };

  await ctx.newConversation(mindId);
  return { status: 200, body: { ok: true } };
}

export async function listModelsHandler(request: ChamberRequest, ctx: ChamberCtx): Promise<ChamberResponse> {
  const body: ListModelsResponse = {
    models: await ctx.listModels(request.query?.get('mindId') ?? undefined),
  };
  return { status: 200, body };
}

function commandResponse(): ChamberResponse {
  const body: CommandResponse = { ok: true };
  return { status: 200, body };
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

function parseChatAttachments(value: unknown): ChatAttachmentDto[] | undefined | null {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return null;
  return value.every(isChatAttachment) ? value : null;
}

function isChatAttachment(value: unknown): value is ChatAttachmentDto {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const attachment = value as Record<string, unknown>;
  return (
    typeof attachment.name === 'string' &&
    typeof attachment.mimeType === 'string' &&
    typeof attachment.data === 'string'
  );
}
