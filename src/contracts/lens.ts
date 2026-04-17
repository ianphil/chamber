import { z } from 'zod';
import { JsonRecordSchema, MindIdSchema, ViewIdSchema } from './primitives';

export const LensViewSchema = z.enum([
  'form',
  'table',
  'briefing',
  'status-board',
  'list',
  'monitor',
  'detail',
  'timeline',
  'editor',
]);
export type LensView = z.infer<typeof LensViewSchema>;

export const LensViewManifestSchema = z.object({
  id: ViewIdSchema,
  name: z.string().min(1),
  icon: z.string().min(1),
  view: LensViewSchema,
  source: z.string().min(1),
  schema: JsonRecordSchema.optional(),
  prompt: z.string().optional(),
  refreshOn: z.enum(['click', 'interval']).optional(),
  /** Resolved absolute path to the view.json directory */
  _basePath: z.string().optional(),
});
export type LensViewManifest = z.infer<typeof LensViewManifestSchema>;

/** `lens:getViews` — [] | [mindId] */
export const LensGetViewsArgs = z.tuple([MindIdSchema.optional()]);
/** `lens:getViewData` — [viewId] | [viewId, mindId] */
export const LensGetViewDataArgs = z.tuple([ViewIdSchema, MindIdSchema.optional()]);
/** `lens:refreshView` — [viewId] | [viewId, mindId] */
export const LensRefreshViewArgs = z.tuple([ViewIdSchema, MindIdSchema.optional()]);
/** `lens:sendAction` — [viewId, action] | [viewId, action, mindId] */
export const LensSendActionArgs = z.tuple([
  ViewIdSchema,
  z.string().min(1),
  MindIdSchema.optional(),
]);
