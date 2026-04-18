import type { ChatroomMessage } from '../../../../shared/chatroom-types';

// ---------------------------------------------------------------------------
// XML helpers — used by strategies that build XML-structured prompts
// ---------------------------------------------------------------------------

const XML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

export function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => XML_ESCAPE_MAP[ch]);
}

export function textContent(msg: ChatroomMessage): string {
  return msg.blocks
    .filter((b) => b.type === 'text')
    .map((b) => (b as { content: string }).content)
    .join('');
}

// ---------------------------------------------------------------------------
// JSON extraction — used by strategies that parse control directives
// ---------------------------------------------------------------------------

/** Extract the outermost JSON object from text using bracket counting (string-aware) */
export function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    if (ch === '}') depth--;
    if (depth === 0) return text.substring(start, i + 1);
  }
  return null;
}

/**
 * Strip a control JSON directive from displayed content.
 * `isControlAction` determines whether a parsed object is a control directive.
 */
export function stripControlJson(
  text: string,
  isControlAction: (action: unknown) => boolean,
): string {
  const json = extractJsonObject(text);
  if (!json) return text;
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    if (isControlAction(parsed.action)) {
      return text.replace(json, '').trim();
    }
  } catch { /* not valid JSON, leave as-is */ }
  return text;
}
