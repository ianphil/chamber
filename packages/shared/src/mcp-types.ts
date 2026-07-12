/**
 * Renderer-facing MCP server configuration model.
 *
 * These types describe the subset of a mind's `.mcp.json` that the Extensions
 * hub lets users manage: a name plus either a stdio launch command or an HTTP
 * endpoint. Management reads reuse the runtime MCP schema (`mcpConfig.ts`) to
 * decide which raw entries are surfaced as editable — entries the runtime would
 * reject are preserved on disk unchanged rather than normalized into an
 * executable config.
 *
 * The `preserved` bag carries runtime fields the UI does not edit but must
 * round-trip verbatim (including across a rename) so a management edit never
 * silently drops server configuration. `tools` is a security-sensitive
 * allowlist: losing it widens a server to all tools, so it is always preserved.
 */

export type McpServerTransport = 'stdio' | 'http';

/** Exact runtime discriminator for a command-based (stdio-family) server. */
export type McpStdioType = 'stdio' | 'local';
/** Exact runtime discriminator for a URL-based (http-family) server. */
export type McpHttpType = 'http' | 'sse';

/**
 * Runtime server fields Chamber's Extensions UI does not edit but preserves
 * verbatim on save. Carried with the entry so a rename keeps them (rather than
 * dropping `tools` and widening the server to `['*']`).
 */
export interface McpPreservedServerFields {
  /** Exact runtime type, e.g. `sse` vs `http`, preserved through serialization. */
  type?: McpStdioType | McpHttpType;
  /** Tool allowlist. Absence means the runtime defaults to all tools (`['*']`). */
  tools?: string[];
  timeout?: number;
  /** stdio-only working directory. */
  cwd?: string;
}

interface McpServerEntryBase {
  name: string;
  preserved?: McpPreservedServerFields;
}

export interface McpStdioServerEntry extends McpServerEntryBase {
  transport: 'stdio';
  /** Executable to launch, e.g. `npx`. */
  command: string;
  /** Arguments passed to the command. */
  args: string[];
  /** Environment variables for the spawned process. */
  env: Record<string, string>;
}

export interface McpHttpServerEntry extends McpServerEntryBase {
  transport: 'http';
  /** Remote MCP endpoint URL. */
  url: string;
  /** Extra request headers (e.g. Authorization). */
  headers: Record<string, string>;
}

/**
 * A single configured MCP server as surfaced to the renderer. The `transport`
 * discriminant selects the stdio or http shape.
 */
export type McpServerEntry = McpStdioServerEntry | McpHttpServerEntry;
