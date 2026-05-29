import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CronJob, CronMigrationError, StoredCronJobs, StoredCronMigrationErrors } from '../types';
import { STORED_CRON_SCHEMA_VERSION } from '../types';
import { Logger } from '../../logger';

const log = Logger.create('cron-migration');

const CRON_DIR = '.chamber';
const SCHEDULES_DIR = 'schedules';
const MIGRATED_DIR = path.join('.chamber', 'automation', '_migrated');
const JOBS_FILE = 'cron.json';
const BACKUP_FILE = 'cron.v1.backup.json';
const ERRORS_FILE = 'cron.migration-errors.json';

interface LegacyJobBase {
  id: string;
  name: string;
  schedule: string;
  enabled?: boolean;
  timeoutMs?: number;
  createdAt?: string;
  updatedAt?: string;
  lastRunAt?: string;
  lastRunStatus?: string;
}

type LegacyJob =
  | (LegacyJobBase & { type: 'prompt'; payload: { prompt?: string; recipient?: string } })
  | (LegacyJobBase & { type: 'shell'; payload: { command?: string; args?: string[] } })
  | (LegacyJobBase & { type: 'webhook'; payload: { url?: string; method?: string; headers?: Record<string, string>; body?: unknown } })
  | (LegacyJobBase & { type: 'notification'; payload: { title?: string; body?: string } });

/**
 * One-shot v1 → v2 cron migration. Idempotent: a second invocation against
 * an already-migrated mind is a no-op. Per-job translation failures land in
 * `.chamber/cron.migration-errors.json` and are surfaced to the user; cron
 * is unblocked for the jobs that did translate.
 */
export function runMigrations(mindPath: string): void {
  const cronDir = path.join(mindPath, CRON_DIR);
  if (!fs.existsSync(cronDir)) return;

  const { sourcePath, raw } = readLegacyJobs(mindPath);
  if (!sourcePath || !raw) return;

  // Already v2? bail.
  if (raw.schemaVersion === STORED_CRON_SCHEMA_VERSION) return;

  log.info(`Migrating cron jobs from v1 to v2 in ${mindPath}`);
  writeBackup(sourcePath, raw);

  const migratedDir = path.join(mindPath, MIGRATED_DIR);
  fs.mkdirSync(migratedDir, { recursive: true });

  const newJobs: CronJob[] = [];
  const errors: CronMigrationError[] = [];
  const usedNames = new Set<string>();

  for (const legacy of (raw.jobs ?? []) as LegacyJob[]) {
    try {
      const contents = translateJob(legacy);
      const fileName = writeMigratedScript(migratedDir, slugify(legacy.id), contents, usedNames);
      // Store scriptPath POSIX-style so cron.json stays portable across platforms.
      newJobs.push(toV2Job(legacy, path.posix.join('.chamber', 'automation', '_migrated', fileName)));
    } catch (err) {
      errors.push({
        legacyId: legacy.id,
        legacyType: (legacy as { type?: string }).type ?? 'unknown',
        legacyName: legacy.name,
        reason: err instanceof Error ? err.message : String(err),
        capturedAt: new Date().toISOString(),
      });
    }
  }

  const newState: StoredCronJobs = {
    schemaVersion: STORED_CRON_SCHEMA_VERSION,
    jobs: newJobs,
  };
  writeJsonAtomic(sourcePath, newState);

  if (errors.length > 0) {
    const errorsPath = path.join(cronDir, ERRORS_FILE);
    const existing = readErrors(errorsPath);
    writeJsonAtomic(errorsPath, { errors: [...existing.errors, ...errors] });
    log.warn(`Cron migration completed with ${errors.length} quarantined job(s) for ${mindPath}`);
  }
}

function translateJob(legacy: LegacyJob): string {
  switch (legacy.type) {
    case 'prompt': {
      const prompt = legacy.payload?.prompt;
      if (typeof prompt !== 'string' || prompt.trim() === '') {
        throw new Error('prompt job missing payload.prompt');
      }
      const recipient = legacy.payload?.recipient;
      return promptScript(prompt, recipient);
    }
    case 'shell': {
      const command = legacy.payload?.command;
      if (typeof command !== 'string' || command.trim() === '') {
        throw new Error('shell job missing payload.command');
      }
      const args = Array.isArray(legacy.payload?.args) ? legacy.payload.args : [];
      return shellScript(command, args, legacy.timeoutMs);
    }
    case 'webhook': {
      const url = legacy.payload?.url;
      if (typeof url !== 'string' || url.trim() === '') {
        throw new Error('webhook job missing payload.url');
      }
      return webhookScript(
        url,
        legacy.payload.method ?? 'POST',
        legacy.payload.headers ?? {},
        legacy.payload.body,
      );
    }
    case 'notification': {
      const title = legacy.payload?.title;
      const body = legacy.payload?.body;
      if (typeof title !== 'string' || typeof body !== 'string') {
        throw new Error('notification job missing payload.title or payload.body');
      }
      return notificationScript(title, body);
    }
    default: {
      const t = (legacy as { type?: string }).type ?? 'unknown';
      throw new Error(`unknown legacy job type: ${t}`);
    }
  }
}

function toV2Job(legacy: LegacyJob, scriptRelPath: string): CronJob {
  const now = new Date().toISOString();
  return {
    id: legacy.id,
    name: legacy.name,
    schedule: legacy.schedule,
    scriptPath: scriptRelPath,
    enabled: legacy.enabled ?? true,
    ...(legacy.timeoutMs !== undefined ? { timeoutMs: legacy.timeoutMs } : {}),
    createdAt: legacy.createdAt ?? now,
    updatedAt: now,
    ...(legacy.lastRunAt ? { lastRunAt: legacy.lastRunAt } : {}),
    isMigrated: true,
  };
}

// --- Script templates (codegen) ---

function promptScript(prompt: string, recipient?: string): string {
  // v1 prompt jobs could target another mind via `recipient`. v2 runs prompts
  // against the script's owning mind only (cross-mind routing intentionally
  // dropped — see AGENTS.md orchestration-safety boundary). Surface the
  // original recipient as a comment so the author can re-route deliberately
  // rather than silently losing it.
  const recipientNote = recipient
    ? `// NOTE: the original cron job targeted recipient ${JSON.stringify(recipient)}.\n`
      + `// Cross-mind prompt routing is not supported in v2; this prompt now runs\n`
      + `// against the mind that owns this script. Edit if you need different behavior.\n`
    : '';
  return `${header()}${recipientNote}
import { TaskGraph } from '@ianphil/ttasks-ts';
import { chamberPrompt, runGraph } from '@chamber/automation-runtime';

const graph = new TaskGraph({ id: process.env.CHAMBER_GRAPH_ID });
graph.add(chamberPrompt({
  prompt: ${JSON.stringify(prompt)},
}));
await runGraph(graph);
`;
}

function shellScript(command: string, args: string[], timeoutMs?: number): string {
  const tokens = [command, ...args].map((token) => JSON.stringify(token)).join(', ');
  const timeoutLine = typeof timeoutMs === 'number' ? `, { timeout: ${timeoutMs} }` : '';
  return `${header()}
import { Task, TaskGraph } from '@ianphil/ttasks-ts';
import { runGraph } from '@chamber/automation-runtime';

const cmd = [${tokens}].join(' ');
const graph = new TaskGraph({ id: process.env.CHAMBER_GRAPH_ID });
graph.add(Task.bash(cmd${timeoutLine}));
await runGraph(graph);
`;
}

function webhookScript(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: unknown,
): string {
  return `${header()}
import { TaskGraph } from '@ianphil/ttasks-ts';
import { runGraph } from '@chamber/automation-runtime';
import { httpTask } from '@chamber/automation-runtime/task-helpers';

const graph = new TaskGraph({ id: process.env.CHAMBER_GRAPH_ID });
graph.add(httpTask({
  url: ${JSON.stringify(url)},
  method: ${JSON.stringify(method)},
  headers: ${JSON.stringify(headers)},
  body: ${JSON.stringify(body ?? null)},
}));
await runGraph(graph);
`;
}

function notificationScript(title: string, body: string): string {
  return `${header()}
import { TaskGraph } from '@ianphil/ttasks-ts';
import { chamberNotify, runGraph } from '@chamber/automation-runtime';

const graph = new TaskGraph({ id: process.env.CHAMBER_GRAPH_ID });
graph.add(chamberNotify({
  title: ${JSON.stringify(title)},
  body: ${JSON.stringify(body)},
}));
await runGraph(graph);
`;
}

function header(): string {
  return `// Auto-generated by Chamber v1 → v2 cron migration.
// You can edit this file freely; the migration will not overwrite it.
`;
}

// --- IO helpers ---

function readLegacyJobs(
  mindPath: string,
): { sourcePath: string | null; raw: (StoredCronJobs & { jobs: LegacyJob[] }) | null } {
  const candidates = [
    path.join(mindPath, CRON_DIR, JOBS_FILE),
    path.join(mindPath, CRON_DIR, SCHEDULES_DIR, JOBS_FILE),
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
      return { sourcePath: p, raw };
    } catch (err) {
      throw new Error(`Cron migration aborted: corrupt JSON at ${p}: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
    }
  }
  return { sourcePath: null, raw: null };
}

function readErrors(errorsPath: string): StoredCronMigrationErrors {
  if (!fs.existsSync(errorsPath)) return { errors: [] };
  try {
    return JSON.parse(fs.readFileSync(errorsPath, 'utf8'));
  } catch {
    return { errors: [] };
  }
}

function writeBackup(sourcePath: string, raw: unknown): void {
  const backupPath = path.join(path.dirname(sourcePath), BACKUP_FILE);
  if (fs.existsSync(backupPath)) return; // idempotent
  writeJsonAtomic(backupPath, raw);
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(temp, filePath);
}

/**
 * Writes a migrated script into `dir`, choosing a filename derived from
 * `baseName` that is unique within this migration run (tracked via `used`) and
 * does not clobber a different existing file. Returns the chosen filename.
 *
 * Distinct legacy jobs whose ids slugify identically therefore each get their
 * own file (`slug.ts`, `slug-2.ts`, …) instead of silently sharing one — and
 * the returned name is what the v2 job points at, keeping job ↔ file in sync.
 * A re-run that finds an identical file reuses it (idempotent).
 */
function writeMigratedScript(
  dir: string,
  baseName: string,
  contents: string,
  used: Set<string>,
): string {
  for (let n = 1; ; n += 1) {
    const candidate = n === 1 ? `${baseName}.ts` : `${baseName}-${n}.ts`;
    if (used.has(candidate)) continue;
    const abs = path.join(dir, candidate);
    if (!fs.existsSync(abs)) {
      used.add(candidate);
      fs.writeFileSync(abs, contents, { flag: 'wx' });
      return candidate;
    }
    // Exists on disk: reuse if identical (idempotent re-run), else try the
    // next candidate so a user's edited file is never overwritten.
    if (fs.readFileSync(abs, 'utf8') === contents) {
      used.add(candidate);
      return candidate;
    }
  }
}

function slugify(id: string): string {
  const slug = id
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || 'job';
}
