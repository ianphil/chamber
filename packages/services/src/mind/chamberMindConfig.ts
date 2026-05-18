// Reads a mind's `.chamber.json` and returns the chamber-managed slice of
// session config that needs per-mind customization. Missing file → empty
// config; invalid JSON / failing schema → warn + empty (consistent with
// `mcpConfig.ts`, so a typo in one file never bricks a mind).
//
// Schema (intentionally small — extend additively):
//   {
//     "excludedTools": ["shell", "str_replace"]
//   }
//
// `excludedTools` maps directly onto `SessionConfig.excludedTools`
// (SDK 0.3.0). Names match the tool names the CLI registers — see
// `copilot help tools` for the full list. This is per-agent in chamber
// terms because each mind runs its own CopilotClient + session.
//
// Issue #131 checklist 6.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import { Logger } from '../logger';

const log = Logger.create('chamberMindConfig');

const chamberMindConfigSchema = z.object({
  excludedTools: z.array(z.string().min(1)).optional(),
}).passthrough();

export const CHAMBER_MIND_CONFIG_FILENAME = '.chamber.json';

export interface ChamberMindConfig {
  excludedTools?: string[];
}

export function loadChamberMindConfig(mindPath: string): ChamberMindConfig {
  const filePath = path.join(mindPath, CHAMBER_MIND_CONFIG_FILENAME);
  if (!fs.existsSync(filePath)) return {};

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    log.warn(`Failed to read ${filePath}; skipping chamber mind config:`, err);
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    log.warn(`Invalid JSON in ${filePath}; skipping chamber mind config:`, err);
    return {};
  }

  const result = chamberMindConfigSchema.safeParse(parsed);
  if (!result.success) {
    log.warn(`Schema validation failed for ${filePath}; skipping chamber mind config:`, result.error.issues);
    return {};
  }

  const out: ChamberMindConfig = {};
  if (result.data.excludedTools && result.data.excludedTools.length > 0) {
    out.excludedTools = [...result.data.excludedTools];
  }
  return out;
}
