import type { MindContext } from '@chamber/shared/types';

// ---------------------------------------------------------------------------
// Composer power-ups — pure helpers shared by ChatInput and its tests.
//
// Everything here is DOM-free and side-effect-free so the detection, filtering
// and prompt-folding logic can be unit tested in isolation. ChatInput owns the
// stateful/DOM concerns (FileReader, caret math, React state).
// ---------------------------------------------------------------------------

// Attachment tokens ---------------------------------------------------------
//
// A token is the inline marker the user sees for an attachment, e.g.
// `[📷#3 photo.png]`. The authoritative key is the opaque numeric id (`#3`),
// never the filename: filenames may contain `]`, `[` or newlines that would
// otherwise break token parsing or let one token bleed into the next. The
// display label is sanitized of those characters so the token is always
// well-formed, while the real filename is preserved on the attachment payload
// for sending and for folded-file headers.

/** Marker prefix for pasted/attached images (carried to the SDK as blobs). */
export const IMAGE_TOKEN_EMOJI = '📷';
/** Marker prefix for text-like files (folded into the outgoing prompt). */
export const FILE_TOKEN_EMOJI = '📄';

/** Strip characters that would break token structure from a display label. */
export function sanitizeTokenLabel(name: string): string {
  return name.replace(/[[\]\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function imageToken(id: number, name: string): string {
  return `[${IMAGE_TOKEN_EMOJI}#${id} ${sanitizeTokenLabel(name)}]`;
}

export function fileToken(id: number, name: string): string {
  return `[${FILE_TOKEN_EMOJI}#${id} ${sanitizeTokenLabel(name)}]`;
}

// Fresh RegExp instances per call so the global `lastIndex` is never shared.
// The label class `[^\][\n]*` excludes brackets and newlines, so a token can
// never span another token and the trailing `]` is unambiguous.
function imageTokenRe(): RegExp {
  return /\[📷#(\d+) [^\][\n]*\]/g;
}

function fileTokenRe(): RegExp {
  return /\[📄#(\d+) [^\][\n]*\]/g;
}

function anyTokenRe(): RegExp {
  return /\[(?:📷|📄)#(\d+) [^\][\n]*\]/g;
}

function collectIds(text: string, re: RegExp): Set<number> {
  const ids = new Set<number>();
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) ids.add(Number(match[1]));
  return ids;
}

/** Ids of image tokens currently present in `text`. */
export function collectImageIds(text: string): Set<number> {
  return collectIds(text, imageTokenRe());
}

/** Ids of file tokens currently present in `text`. */
export function collectFileIds(text: string): Set<number> {
  return collectIds(text, fileTokenRe());
}

/** True when `index` falls within any attachment token span. */
export function isInsideAttachmentToken(text: string, index: number): boolean {
  const re = anyTokenRe();
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (index >= start && index < end) return true;
  }
  return false;
}

// @-mentions ----------------------------------------------------------------

export interface MentionMatch {
  /** Index of the leading `@` in the source text. */
  start: number;
  /** Lowercased query typed after `@` (may be empty). */
  query: string;
}

// `@` at start-of-string or after whitespace / ( [ { , followed by an optional
// word-ish body up to the caret. Mirrors the boundary rules of SHORTCODE_RE.
const MENTION_RE = /(^|[\s([{])@([a-z0-9_-]*)$/i;

export function detectMention(text: string, caret: number): MentionMatch | null {
  const upToCaret = text.slice(0, caret);
  const match = MENTION_RE.exec(upToCaret);
  if (!match) return null;
  const query = match[2];
  const start = caret - (query.length + 1); // include the `@`
  if (isInsideAttachmentToken(text, start)) return null;
  return { start, query: query.toLowerCase() };
}

export interface Mentionable {
  mindId: string;
  name: string;
}

export function toMentionables(minds: readonly MindContext[]): Mentionable[] {
  return minds.map((mind) => ({ mindId: mind.mindId, name: mind.identity.name }));
}

export function filterMentionables(items: readonly Mentionable[], query: string, limit = 8): Mentionable[] {
  const q = query.toLowerCase();
  const matched = q.length === 0 ? items : items.filter((item) => item.name.toLowerCase().includes(q));
  return matched.slice(0, limit);
}

// Slash commands ------------------------------------------------------------

export type SlashCommandId = 'new' | 'clear' | 'model' | 'settings';

export interface SlashCommand {
  id: SlashCommandId;
  /** Display label including the leading slash, e.g. `/new`. */
  name: string;
  hint: string;
}

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  { id: 'new', name: '/new', hint: 'Start a new conversation' },
  { id: 'clear', name: '/clear', hint: 'Clear the composer' },
  { id: 'model', name: '/model', hint: 'Choose the model' },
  { id: 'settings', name: '/settings', hint: 'Open settings' },
];

export interface SlashMatch {
  /** Lowercased query typed after the leading `/` (may be empty). */
  query: string;
}

// Only a bare command token at the very start triggers the menu: `/`, `/ne`,
// `/settings`. As soon as a space or newline is typed the menu closes.
const SLASH_RE = /^\/([a-z]*)$/i;

export function detectSlash(text: string): SlashMatch | null {
  const match = SLASH_RE.exec(text);
  if (!match) return null;
  return { query: match[1].toLowerCase() };
}

export function filterSlashCommands(commands: readonly SlashCommand[], query: string): SlashCommand[] {
  const q = query.toLowerCase();
  if (q.length === 0) return [...commands];
  return commands.filter((command) => command.id.startsWith(q));
}

// File classification + prompt folding --------------------------------------

/** Max size we will inline as text; larger text files are skipped. */
export const MAX_TEXT_FILE_BYTES = 256 * 1024;

/** Max image payload we will attach as a blob; larger images are skipped. */
export const MAX_IMAGE_FILE_BYTES = 10 * 1024 * 1024;

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'heic', 'heif', 'ico']);

const TEXT_LIKE_MIME = new Set([
  'application/json',
  'application/xml',
  'application/javascript',
  'application/ecmascript',
  'application/typescript',
  'application/x-yaml',
  'application/yaml',
  'application/x-sh',
  'application/x-httpd-php',
  'application/sql',
  'application/graphql',
]);

const TEXT_LIKE_EXT = new Set([
  'txt', 'text', 'md', 'markdown', 'mdx', 'rst', 'csv', 'tsv', 'log',
  'json', 'jsonc', 'json5', 'yaml', 'yml', 'toml', 'ini', 'env', 'conf', 'cfg', 'properties',
  'xml', 'html', 'htm', 'svg', 'css', 'scss', 'sass', 'less',
  'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts', 'vue', 'svelte',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'kts', 'c', 'h', 'cpp', 'cc', 'hpp', 'cs',
  'php', 'sh', 'bash', 'zsh', 'ps1', 'psm1', 'bat', 'cmd', 'sql', 'graphql', 'gql',
  'r', 'pl', 'lua', 'dart', 'scala', 'clj', 'ex', 'exs', 'erl', 'hs', 'elm', 'swift',
  'dockerfile', 'gitignore', 'gitattributes', 'editorconfig', 'npmrc', 'nvmrc', 'diff', 'patch',
]);

function extensionOf(name: string): string {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf('.');
  return dot >= 0 ? lower.slice(dot + 1) : lower;
}

export function isImageFile(file: { name: string; mimeType: string }): boolean {
  if (file.mimeType.toLowerCase().startsWith('image/')) return true;
  return IMAGE_EXT.has(extensionOf(file.name));
}

export function isTextLikeFile(file: { name: string; mimeType: string }): boolean {
  const mime = file.mimeType.toLowerCase();
  if (mime.startsWith('text/')) return true;
  if (TEXT_LIKE_MIME.has(mime) || mime.endsWith('+json') || mime.endsWith('+xml')) return true;
  return TEXT_LIKE_EXT.has(extensionOf(file.name));
}

export interface TextFileAttachment {
  id: number;
  name: string;
  mimeType: string;
  content: string;
}

/**
 * Choose a backtick fence longer than any backtick run in `content`, so folded
 * file bodies that themselves contain ``` fences cannot terminate the block
 * early. Never shorter than the standard three backticks.
 */
export function safeFenceFor(content: string): string {
  let longestRun = 0;
  const matches = content.match(/`+/g);
  if (matches) {
    for (const run of matches) longestRun = Math.max(longestRun, run.length);
  }
  return '`'.repeat(Math.max(3, longestRun + 1));
}

/**
 * Fold the contents of any text attachments whose token still appears in
 * `input` into the outgoing prompt as labelled fenced blocks. Image tokens are
 * left untouched (their payload rides along as a separate blob attachment).
 * Attachments are matched by opaque id, never by filename.
 */
export function buildMessageWithTextAttachments(input: string, files: readonly TextFileAttachment[]): string {
  if (files.length === 0) return input;
  const presentIds = collectFileIds(input);
  const kept = files.filter((file) => presentIds.has(file.id));
  if (kept.length === 0) return input;
  const blocks = kept.map((file) => {
    const fence = safeFenceFor(file.content);
    return `Attached file ${file.name}:\n${fence}\n${file.content}\n${fence}`;
  });
  const base = input.trimEnd();
  return `${base}${base.length > 0 ? '\n\n' : ''}${blocks.join('\n\n')}`;
}
