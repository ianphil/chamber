import type { McpServerEntry, McpServerTransport, McpPreservedServerFields } from '@chamber/shared/mcp-types';

/**
 * Editable form representation of a single MCP server. Multi-value fields are
 * held as raw text (one item per line) so the textarea stays the source of
 * truth while the user types; {@link formToEntry} parses them on save.
 *
 * `preserved` carries the entry's non-UI-edited runtime fields (tools, timeout,
 * cwd, exact type) untouched so editing or renaming a server never drops them.
 */
export interface McpServerFormState {
  name: string;
  transport: McpServerTransport;
  command: string;
  argsText: string;
  envText: string;
  url: string;
  headersText: string;
  preserved?: McpPreservedServerFields;
}

export function emptyMcpForm(): McpServerFormState {
  return { name: '', transport: 'stdio', command: '', argsText: '', envText: '', url: '', headersText: '' };
}

export function entryToForm(entry: McpServerEntry): McpServerFormState {
  const base = emptyMcpForm();
  const preservedProp = entry.preserved ? { preserved: entry.preserved } : {};
  if (entry.transport === 'stdio') {
    return {
      ...base,
      name: entry.name,
      transport: 'stdio',
      command: entry.command,
      argsText: formatArgs(entry.args),
      envText: formatKeyValues(entry.env),
      ...preservedProp,
    };
  }
  return {
    ...base,
    name: entry.name,
    transport: 'http',
    url: entry.url,
    headersText: formatKeyValues(entry.headers),
    ...preservedProp,
  };
}

/** Builds a normalized entry from a form. Assumes {@link validateMcpForm} passed. */
export function formToEntry(form: McpServerFormState): McpServerEntry {
  const name = form.name.trim();
  const preservedProp = form.preserved ? { preserved: form.preserved } : {};
  if (form.transport === 'stdio') {
    return {
      name,
      transport: 'stdio',
      command: form.command.trim(),
      args: parseArgs(form.argsText),
      env: parseKeyValues(form.envText),
      ...preservedProp,
    };
  }
  return {
    name,
    transport: 'http',
    url: form.url.trim(),
    headers: parseKeyValues(form.headersText),
    ...preservedProp,
  };
}

/**
 * Validates a form against the names already in use by other servers. Returns a
 * human-readable message, or null when the form is valid.
 */
export function validateMcpForm(form: McpServerFormState, otherNames: readonly string[]): string | null {
  const name = form.name.trim();
  if (name.length === 0) return 'Name is required.';
  if (otherNames.includes(name)) return `A server named "${name}" already exists.`;

  if (form.transport === 'stdio') {
    if (form.command.trim().length === 0) return 'Command is required for a stdio server.';
    return null;
  }

  const url = form.url.trim();
  if (url.length === 0) return 'URL is required for an HTTP server.';
  if (!isValidUrl(url)) return 'Enter a valid URL (including the scheme, e.g. https://).';
  return null;
}

/** Splits a textarea into trimmed, non-empty lines (one argument per line). */
export function parseArgs(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function formatArgs(args: string[]): string {
  return args.join('\n');
}

/**
 * Parses `KEY=VALUE` lines into a record. The first `=` separates key from
 * value so values may contain `=`. Lines without a non-empty key are skipped.
 */
export function parseKeyValues(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.length === 0) continue;
    const eq = line.indexOf('=');
    const key = (eq === -1 ? line : line.slice(0, eq)).trim();
    const value = eq === -1 ? '' : line.slice(eq + 1).trim();
    if (key.length > 0) out[key] = value;
  }
  return out;
}

export function formatKeyValues(record: Record<string, string>): string {
  return Object.entries(record)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

function isValidUrl(value: string): boolean {
  try {
    return Boolean(new URL(value));
  } catch {
    return false;
  }
}
