import type { ChamberCtx, ChamberRequest, ChamberResponse } from './types';
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
  if (!ctx.addMind) {
    return { status: 503, body: { error: 'Mind loading is unavailable' } };
  }
  try {
    return { status: 200, body: { mind: await ctx.addMind(mindPath) } };
  } catch (error) {
    return { status: 400, body: { error: error instanceof Error ? error.message : String(error) } };
  }
}

export async function getConfigHandler(_request: ChamberRequest, ctx: ChamberCtx): Promise<ChamberResponse> {
  return { status: 200, body: await ctx.getConfig?.() ?? { version: 1 } };
}

export async function listLensViewsHandler(_request: ChamberRequest, ctx: ChamberCtx): Promise<ChamberResponse> {
  return { status: 200, body: { views: await ctx.listLensViews?.() ?? [] } };
}

export async function getGenesisStatusHandler(_request: ChamberRequest, ctx: ChamberCtx): Promise<ChamberResponse> {
  return { status: 200, body: await ctx.getGenesisStatus?.() ?? { ready: false } };
}

export async function getAuthStatusHandler(_request: ChamberRequest, ctx: ChamberCtx): Promise<ChamberResponse> {
  return { status: 200, body: await ctx.getAuthStatus?.() ?? { authenticated: false } };
}

export async function listAuthAccountsHandler(_request: ChamberRequest, ctx: ChamberCtx): Promise<ChamberResponse> {
  return { status: 200, body: { accounts: await ctx.listAuthAccounts?.() ?? [] } };
}

export async function switchAuthAccountHandler(request: ChamberRequest, ctx: ChamberCtx): Promise<ChamberResponse> {
  const login = typeof request.body === 'object' && request.body !== null && 'login' in request.body
    ? String((request.body as { login: unknown }).login)
    : '';
  if (!login) {
    return { status: 400, body: { error: 'login is required' } };
  }
  if (!ctx.switchAuthAccount) {
    return { status: 503, body: { error: 'Auth account switching is unavailable' } };
  }
  await ctx.switchAuthAccount(login);
  return { status: 200, body: { ok: true } };
}

export async function logoutAuthHandler(_request: ChamberRequest, ctx: ChamberCtx): Promise<ChamberResponse> {
  if (!ctx.logoutAuth) {
    return { status: 503, body: { error: 'Auth logout is unavailable' } };
  }
  await ctx.logoutAuth();
  return { status: 200, body: { ok: true } };
}

export async function listChamberToolsHandler(_request: ChamberRequest, ctx: ChamberCtx): Promise<ChamberResponse> {
  return { status: 200, body: { tools: ctx.listChamberTools?.() ?? [] } };
}

export async function uploadAttachmentHandler(request: ChamberRequest, ctx: ChamberCtx): Promise<ChamberResponse> {
  const name = request.query?.get('name')?.trim();
  if (!name) {
    return { status: 400, body: { error: 'Attachment name is required' } };
  }
  if (!request.body || !(request.body instanceof ArrayBuffer)) {
    return { status: 400, body: { error: 'Attachment body is required' } };
  }
  const result = await ctx.saveAttachment?.({ name, body: request.body }) ?? { name };
  return { status: 200, body: result };
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
  await ctx.cancelChat?.(mindId, messageId);
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
  if (!ctx.sendChat) return { status: 503, body: { error: 'Chat is unavailable' } };

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
  if (!ctx.newConversation) return { status: 503, body: { error: 'Chat is unavailable' } };

  await ctx.newConversation(mindId);
  return { status: 200, body: { ok: true } };
}

export async function listModelsHandler(request: ChamberRequest, ctx: ChamberCtx): Promise<ChamberResponse> {
  if (!ctx.listModels) return { status: 503, body: { error: 'Model listing is unavailable' } };
  const body: ListModelsResponse = {
    models: await ctx.listModels(request.query?.get('mindId') ?? undefined),
  };
  return { status: 200, body };
}

function commandResponse(): ChamberResponse {
  const body: CommandResponse = { ok: true };
  return { status: 200, body };
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
