// Reads a mind's `.chamber.json` and returns the chamber-managed slice of
// session config that needs per-mind customization. Missing file → empty
// config (with `workingMemory.consolidation` defaults applied); invalid
// JSON / failing top-level schema → warn + defaults (consistent with
// `mcpConfig.ts`, so a typo in one file never bricks a mind).
//
// Schema (intentionally small — extend additively):
//   {
//     "excludedTools": ["shell", "str_replace"],
//     "workingMemory": {
//       "consolidation": {
//         "enabled": false,
//         "cron": "0 3 * * *",
//         "lastKTurns": 10,
//         "perTurnMaxBytes": 2048,
//         "memoryMaxBytes": 8192
//       }
//     }
//   }
//
// `excludedTools` maps directly onto `SessionConfig.excludedTools`
// (SDK 0.3.0). Names match the tool names the CLI registers — see
// `copilot help tools` for the full list. This is per-agent in chamber
// terms because each mind runs its own CopilotClient + session.
//
// `workingMemory.consolidation` is the per-mind opt-in for the Dream
// Daemon (issue: dream-daemon spike, Phase 4). Defaults are OFF — the
// daemon never activates unless `enabled: true`. Cron validation is
// deferred to the InternalScheduler (Phase 10); here we only enforce
// `z.string()`. Numeric fields are positive integers; composer (Phase
// 12) enforces hard caps as defense in depth.
//
// Validation strategy mirrors the rest of this loader: per-field
// `safeParse`. An invalid field falls back to the default and emits a
// `log.warn` — never throws, never bricks the mind.
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

export interface WorkingMemoryConsolidationConfig {
  enabled: boolean;
  cron: string;
  lastKTurns: number;
  perTurnMaxBytes: number;
  memoryMaxBytes: number;
}

export interface WorkingMemoryConfig {
  consolidation: WorkingMemoryConsolidationConfig;
}

export interface ChamberMindConfig {
  excludedTools?: string[];
  workingMemory: WorkingMemoryConfig;
}

export const DEFAULT_WORKING_MEMORY_CONSOLIDATION: Readonly<WorkingMemoryConsolidationConfig> = Object.freeze({
  enabled: false,
  cron: '0 3 * * *',
  lastKTurns: 10,
  perTurnMaxBytes: 2048,
  memoryMaxBytes: 8192,
});

const consolidationFieldSchemas: { [K in keyof WorkingMemoryConsolidationConfig]: z.ZodType<WorkingMemoryConsolidationConfig[K]> } = {
  enabled: z.boolean(),
  cron: z.string(),
  lastKTurns: z.number().int().positive(),
  perTurnMaxBytes: z.number().int().positive(),
  memoryMaxBytes: z.number().int().positive(),
};

function defaultWorkingMemory(): WorkingMemoryConfig {
  return { consolidation: { ...DEFAULT_WORKING_MEMORY_CONSOLIDATION } };
}

function parseWorkingMemory(raw: unknown, filePath: string): WorkingMemoryConfig {
  const out = defaultWorkingMemory();
  if (raw === undefined) return out;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    log.warn(`Invalid workingMemory in ${filePath}; expected object, falling back to defaults.`);
    return out;
  }

  const wm = raw as Record<string, unknown>;
  const consolidationRaw = wm.consolidation;
  if (consolidationRaw === undefined) return out;
  if (consolidationRaw === null || typeof consolidationRaw !== 'object' || Array.isArray(consolidationRaw)) {
    log.warn(`Invalid workingMemory.consolidation in ${filePath}; expected object, falling back to defaults.`);
    return out;
  }

  const consolidation = consolidationRaw as Record<string, unknown>;
  for (const key of Object.keys(consolidationFieldSchemas) as Array<keyof WorkingMemoryConsolidationConfig>) {
    if (!(key in consolidation)) continue;
    const schema = consolidationFieldSchemas[key];
    const result = schema.safeParse(consolidation[key]);
    if (result.success) {
      // Type-safe write via per-key narrowing.
      (out.consolidation[key] as WorkingMemoryConsolidationConfig[typeof key]) = result.data;
    } else {
      log.warn(
        `Invalid workingMemory.consolidation.${key} in ${filePath}; using default ${JSON.stringify(DEFAULT_WORKING_MEMORY_CONSOLIDATION[key])}.`,
        result.error.issues,
      );
    }
  }
  return out;
}

export function loadChamberMindConfig(mindPath: string): ChamberMindConfig {
  const filePath = path.join(mindPath, CHAMBER_MIND_CONFIG_FILENAME);
  if (!fs.existsSync(filePath)) {
    return { workingMemory: defaultWorkingMemory() };
  }

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    log.warn(`Failed to read ${filePath}; skipping chamber mind config:`, err);
    return { workingMemory: defaultWorkingMemory() };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    log.warn(`Invalid JSON in ${filePath}; skipping chamber mind config:`, err);
    return { workingMemory: defaultWorkingMemory() };
  }

  const result = chamberMindConfigSchema.safeParse(parsed);
  if (!result.success) {
    log.warn(`Schema validation failed for ${filePath}; skipping chamber mind config:`, result.error.issues);
    return { workingMemory: defaultWorkingMemory() };
  }

  const out: ChamberMindConfig = {
    workingMemory: parseWorkingMemory((result.data as Record<string, unknown>).workingMemory, filePath),
  };
  if (result.data.excludedTools && result.data.excludedTools.length > 0) {
    out.excludedTools = [...result.data.excludedTools];
  }
  return out;
}

// Atomically merge a partial patch into the mind's `.chamber.json`. Reads
// the current raw JSON (preserving unknown top-level passthrough fields per
// `chamberMindConfigSchema.passthrough()`), deep-merges the patch into
// `workingMemory.consolidation`, then writes the result via tmp-file +
// rename. If any step fails, the original file is left untouched and the
// tmp file is removed. Used by `MindManager.enableDreamDaemon` /
// `disableDreamDaemon` so flipping the toggle never half-writes the file.
export interface ChamberMindConfigPatch {
  workingMemory?: {
    consolidation?: Partial<WorkingMemoryConsolidationConfig>;
  };
}

function readRawChamberConfig(filePath: string): Record<string, unknown> {
  if (!fs.existsSync(filePath)) return {};
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    log.warn(`Failed to read ${filePath} during patch; treating as empty:`, err);
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      log.warn(`Existing ${filePath} is not a JSON object during patch; treating as empty.`);
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    log.warn(`Invalid JSON in ${filePath} during patch; treating as empty:`, err);
    return {};
  }
}

export function patchChamberMindConfig(mindPath: string, patch: ChamberMindConfigPatch): void {
  const filePath = path.join(mindPath, CHAMBER_MIND_CONFIG_FILENAME);
  const current = readRawChamberConfig(filePath);

  const currentWorkingMemory = (current.workingMemory && typeof current.workingMemory === 'object' && !Array.isArray(current.workingMemory))
    ? current.workingMemory as Record<string, unknown>
    : {};
  const currentConsolidation = (currentWorkingMemory.consolidation && typeof currentWorkingMemory.consolidation === 'object' && !Array.isArray(currentWorkingMemory.consolidation))
    ? currentWorkingMemory.consolidation as Record<string, unknown>
    : {};

  const merged: Record<string, unknown> = { ...current };
  if (patch.workingMemory) {
    // Only `workingMemory.consolidation` is deep-merged; sibling subkeys
    // (e.g. future `workingMemory.archival`) survive via the spread of
    // `currentWorkingMemory`. Extend this branch when introducing new
    // subkeys that themselves need a deep-merge rather than a clobber.
    merged.workingMemory = {
      ...currentWorkingMemory,
      ...(patch.workingMemory.consolidation
        ? { consolidation: { ...currentConsolidation, ...patch.workingMemory.consolidation } }
        : {}),
    };
  }

  const serialized = `${JSON.stringify(merged, null, 2)}\n`;
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, serialized, 'utf-8');
  try {
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    if (fs.existsSync(tmpPath)) {
      try { fs.rmSync(tmpPath, { force: true }); } catch { /* best-effort cleanup */ }
    }
    throw err;
  }
}
