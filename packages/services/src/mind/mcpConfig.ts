// Reads a mind's `.mcp.json` and returns servers in the shape the Copilot
// SDK's `SessionConfig.mcpServers` expects. Exists because the SDK's
// `enableConfigDiscovery` path doesn't pass `includeWorkspaceSources: true`,
// so workspace-level `.mcp.json` files are silently ignored. Chamber reads
// them itself and threads the result through `client.createSession`.
//
// Schema (subset of the upstream MCP server config — the SDK validates the
// rest):
//   { "mcpServers": {
//       "<name>": { "command": "...", "args": [...], "env": {...}, ... },
//       "<name>": { "type": "http", "url": "...", "headers": {...} }
//   } }
//
// The CLI's `tools` field is required by the SDK type (`MCPServerConfigBase`),
// but real-world `.mcp.json` files almost never set it. We default to `["*"]`
// (all tools allowed) when missing, matching the CLI's discovery behavior.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import type { MCPServerConfig } from '@github/copilot-sdk';
import { Logger } from '../logger';

const log = Logger.create('mcpConfig');

// `.strict()` rejects unknown keys per arm so an entry that mixes `command`
// AND `url` fails with a clear "unrecognized keys" error rather than being
// silently coerced into one arm of the union.
const stdioSchema = z.object({
  type: z.enum(['stdio', 'local']).optional(),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  cwd: z.string().optional(),
  tools: z.array(z.string()).optional(),
  timeout: z.number().optional(),
}).strict();

const httpSchema = z.object({
  type: z.enum(['http', 'sse']),
  url: z.url(),
  headers: z.record(z.string(), z.string()).optional(),
  tools: z.array(z.string()).optional(),
  timeout: z.number().optional(),
}).strict();

const serverSchema = z.union([stdioSchema, httpSchema]);

// Re-exported under public names so the Extensions management layer
// (`mcpServerStore.ts`) classifies entries with the *same* validation the
// runtime uses. This keeps management and runtime in lockstep: an entry the
// runtime would skip is never surfaced as editable nor normalized into an
// executable config.
export const mcpStdioServerSchema = stdioSchema;
export const mcpHttpServerSchema = httpSchema;
export const mcpServerSchema = serverSchema;

// Top-level shape: the file MUST be a valid JSON object whose `mcpServers` is
// an object map. Each entry is validated independently below so a single typo
// only drops that one server, not every server in the file (#199).
const fileSchema = z.object({
  mcpServers: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

export const MCP_CONFIG_FILENAME = '.mcp.json';

export function loadMcpServersFromMindPath(mindPath: string): Record<string, MCPServerConfig> {
  const filePath = path.join(mindPath, MCP_CONFIG_FILENAME);
  if (!fs.existsSync(filePath)) return {};

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    log.warn(`Failed to read ${filePath}; skipping MCP servers:`, err);
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    log.warn(`Invalid JSON in ${filePath}; skipping MCP servers:`, err);
    return {};
  }

  const fileResult = fileSchema.safeParse(parsed);
  if (!fileResult.success) {
    log.warn(`Top-level schema validation failed for ${filePath}; skipping MCP servers:`, fileResult.error.issues);
    return {};
  }

  const servers = fileResult.data.mcpServers ?? {};
  const out: Record<string, MCPServerConfig> = {};
  for (const [name, rawEntry] of Object.entries(servers)) {
    // Per-entry validation: a bad entry only drops itself, not the whole
    // file. Issue #199 explicitly asks to "warn or skip invalid entries".
    const entry = serverSchema.safeParse(rawEntry);
    if (!entry.success) {
      log.warn(`MCP server "${name}" in ${filePath} failed validation; skipping:`, entry.error.issues);
      continue;
    }
    const config = entry.data;
    // Default tools to ["*"] (all) — the SDK's MCPServerConfigBase requires
    // a tools array, but `.mcp.json` files generally omit it. Authors who
    // want to scope server tool access can still set it explicitly.
    const tools = config.tools ?? ['*'];
    if ('command' in config) {
      out[name] = {
        type: config.type ?? 'stdio',
        command: config.command,
        args: config.args ?? [],
        ...(config.env ? { env: config.env } : {}),
        ...(config.cwd ? { cwd: config.cwd } : {}),
        tools,
        ...(config.timeout !== undefined ? { timeout: config.timeout } : {}),
      };
    } else {
      out[name] = {
        type: config.type,
        url: config.url,
        ...(config.headers ? { headers: config.headers } : {}),
        tools,
        ...(config.timeout !== undefined ? { timeout: config.timeout } : {}),
      };
    }
  }
  return out;
}

