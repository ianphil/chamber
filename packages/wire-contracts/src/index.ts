export const WIRE_PROTOCOL_VERSION = 1;

export interface WireEnvelope<TType extends string, TPayload> {
  version: typeof WIRE_PROTOCOL_VERSION;
  type: TType;
  payload: TPayload;
}

export interface PrivilegedEnvelope<TType extends string, TPayload> {
  protoVersion: 1;
  type: TType;
  requestId: string;
  payload: TPayload;
}

export interface MindIdentityDto {
  readonly name: string;
  readonly systemMessage: string;
}

export type MindStatusDto = 'loading' | 'ready' | 'error' | 'unloading';

export interface MindDto {
  readonly mindId: string;
  readonly mindPath: string;
  readonly identity: MindIdentityDto;
  readonly status: MindStatusDto;
  readonly error?: string;
  readonly windowed?: boolean;
}

export interface ListMindsResponse {
  readonly minds: MindDto[];
}

export interface AddMindRequest {
  readonly mindPath: string;
}

export interface AddMindResponse {
  readonly mind: MindDto;
}

export interface ChatAttachmentDto {
  readonly name: string;
  readonly mimeType: string;
  readonly data: string;
}

export interface SendChatRequest {
  readonly mindId: string;
  readonly message: string;
  readonly messageId: string;
  readonly model?: string;
  readonly attachments?: ChatAttachmentDto[];
}

export interface NewConversationRequest {
  readonly mindId: string;
}

export interface CancelChatRequest {
  readonly mindId: string;
  readonly messageId: string;
}

export interface ModelDto {
  readonly id: string;
  readonly name: string;
}

export interface ListModelsResponse {
  readonly models: ModelDto[];
}

export interface CommandResponse {
  readonly ok: true;
}

export type ServerEvent =
  | WireEnvelope<'chat:event', unknown>
  | WireEnvelope<'chatroom:event', unknown>
  | WireEnvelope<'observability:event', unknown>
  | WireEnvelope<'notification', unknown>;
