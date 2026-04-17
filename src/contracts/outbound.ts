import { z } from 'zod';
import { ChatEventSchema } from './chatEvent';
import { MindIdSchema, MessageIdSchema, JsonRecordSchema } from './primitives';
import { MindRecordSchema } from './mind';
import { AuthProgressSchema } from './auth';
import { GenesisProgressSchema } from './genesis';
import { ChatroomStreamEventSchema } from './chatroom';

/**
 * Phase 1 outbound channel schemas — the shape of every `webContents.send`
 * emitted by main. These are NOT parsed at emit time; they are authoritative
 * reference shapes for Phase 2 (WebSocket sidecar) clients which WILL parse
 * incoming push events to defend against version skew.
 *
 * See rubber-duck finding A in plan.md.
 */

/** `chat:event` — payload is (mindId, messageId, event) positional. */
export const ChatEventPushSchema = z.object({
  mindId: MindIdSchema,
  messageId: MessageIdSchema,
  event: ChatEventSchema,
});
export type ChatEventPush = z.infer<typeof ChatEventPushSchema>;

/** `mind:changed` — fires with full MindRecord list. */
export const MindChangedPushSchema = z.array(MindRecordSchema);
export type MindChangedPush = z.infer<typeof MindChangedPushSchema>;

/** `auth:progress` */
export const AuthProgressPushSchema = AuthProgressSchema;
export type AuthProgressPush = z.infer<typeof AuthProgressPushSchema>;

/** `genesis:progress` */
export const GenesisProgressPushSchema = GenesisProgressSchema;
export type GenesisProgressPush = z.infer<typeof GenesisProgressPushSchema>;

/** `chatroom:event` */
export const ChatroomEventPushSchema = ChatroomStreamEventSchema;
export type ChatroomEventPush = z.infer<typeof ChatroomEventPushSchema>;

/**
 * A2A push channels — intentionally `passthrough`. `Part.raw: Uint8Array` is
 * not JSON-RPC safe, so a transport-safe A2A shape is a Phase 2 task (see
 * a2a.ts). Schemas here merely document the outer envelope.
 */
export const A2aIncomingPushSchema = JsonRecordSchema;
export const A2aTaskStatusUpdatePushSchema = JsonRecordSchema;
export const A2aTaskArtifactUpdatePushSchema = JsonRecordSchema;
