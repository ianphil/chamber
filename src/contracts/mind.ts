import { z } from 'zod';
import { MindIdSchema } from './primitives';

export const MindStatusSchema = z.enum(['loading', 'ready', 'error', 'unloading']);
export type MindStatus = z.infer<typeof MindStatusSchema>;

export const MindIdentitySchema = z.object({
  name: z.string().min(1),
  systemMessage: z.string(),
});
export type MindIdentity = z.infer<typeof MindIdentitySchema>;

export const MindContextSchema = z.object({
  mindId: MindIdSchema,
  mindPath: z.string().min(1),
  identity: MindIdentitySchema,
  status: MindStatusSchema,
  error: z.string().optional(),
  windowed: z.boolean().optional(),
});
export type MindContext = z.infer<typeof MindContextSchema>;

export const MindRecordSchema = z.object({
  id: MindIdSchema,
  path: z.string().min(1),
});
export type MindRecord = z.infer<typeof MindRecordSchema>;

/** `mind:add` — [mindPath] */
export const MindAddArgs = z.tuple([z.string().min(1)]);
/** `mind:remove` — [mindId] */
export const MindRemoveArgs = z.tuple([MindIdSchema]);
/** `mind:list` — [] */
export const MindListArgs = z.tuple([]);
/** `mind:setActive` — [mindId] */
export const MindSetActiveArgs = z.tuple([MindIdSchema]);
/** `mind:selectDirectory` — [] */
export const MindSelectDirectoryArgs = z.tuple([]);
/** `mind:openWindow` — [mindId] */
export const MindOpenWindowArgs = z.tuple([MindIdSchema]);
