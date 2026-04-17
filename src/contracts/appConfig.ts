import { z } from 'zod';
import { MindRecordSchema } from './mind';

export const ThemeSchema = z.enum(['light', 'dark', 'system']);
export type Theme = z.infer<typeof ThemeSchema>;

/**
 * AppConfig v2 — ConfigService boundary schema.
 *
 * Phase 1 schematizes only the current (v2) shape. v1→v2 migration lives in
 * ConfigService.migrateV1 and is intentionally out of scope.
 */
export const AppConfigSchema = z.object({
  version: z.literal(2),
  minds: z.array(MindRecordSchema),
  activeMindId: z.string().nullable(),
  activeLogin: z.string().nullable(),
  theme: ThemeSchema,
});
export type AppConfig = z.infer<typeof AppConfigSchema>;
