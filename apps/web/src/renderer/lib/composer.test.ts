import { describe, it, expect } from 'vitest';
import type { MindContext } from '@chamber/shared/types';
import {
  imageToken,
  fileToken,
  sanitizeTokenLabel,
  collectImageIds,
  collectFileIds,
  isInsideAttachmentToken,
  detectMention,
  toMentionables,
  filterMentionables,
  detectSlash,
  filterSlashCommands,
  SLASH_COMMANDS,
  isImageFile,
  isTextLikeFile,
  safeFenceFor,
  buildMessageWithTextAttachments,
} from './composer';

function makeMind(mindId: string, name: string): MindContext {
  return {
    mindId,
    mindPath: `C:\\minds\\${mindId}`,
    identity: { name, systemMessage: '' },
    status: 'ready',
  };
}

describe('attachment tokens', () => {
  it('builds image and file tokens with opaque ids and display labels', () => {
    expect(imageToken(1, 'a.png')).toBe('[📷#1 a.png]');
    expect(fileToken(2, 'notes.md')).toBe('[📄#2 notes.md]');
  });

  it('collects image and file ids independently', () => {
    const text = `hello ${imageToken(1, 'a.png')} and ${fileToken(2, 'notes.md')}`;
    expect(collectImageIds(text)).toEqual(new Set([1]));
    expect(collectFileIds(text)).toEqual(new Set([2]));
  });

  it('keys attachments by id even when the filename contains a closing bracket', () => {
    // A raw "]" in the filename must not break parsing or bleed into the label.
    const token = imageToken(7, 'weird]name].png');
    expect(token).toBe('[📷#7 weird name .png]');
    const text = `before ${token} after ${imageToken(8, 'clean.png')}`;
    expect(collectImageIds(text)).toEqual(new Set([7, 8]));
  });

  it('does not let one token span into the next when labels are adjacent', () => {
    const text = `${imageToken(1, 'a.png')}${imageToken(2, 'b.png')}`;
    expect(collectImageIds(text)).toEqual(new Set([1, 2]));
  });

  it('detects when an index sits inside any attachment token span', () => {
    const text = `x ${imageToken(3, 'a.png')}`;
    const insideStart = text.indexOf('[') + 2;
    expect(isInsideAttachmentToken(text, insideStart)).toBe(true);
    expect(isInsideAttachmentToken(text, 0)).toBe(false);
  });
});

describe('sanitizeTokenLabel', () => {
  it('replaces brackets and newlines and collapses whitespace', () => {
    expect(sanitizeTokenLabel('a]b[c\nd')).toBe('a b c d');
    expect(sanitizeTokenLabel('  spaced   name  ')).toBe('spaced name');
  });
});

describe('detectMention', () => {
  it('matches a bare @ at the caret', () => {
    const match = detectMention('@', 1);
    expect(match).toEqual({ start: 0, query: '' });
  });

  it('matches @query after whitespace and lowercases the query', () => {
    const text = 'hey @Al';
    const match = detectMention(text, text.length);
    expect(match).toEqual({ start: 4, query: 'al' });
  });

  it('does not match an @ glued to a preceding word (email-like)', () => {
    const text = 'user@host';
    expect(detectMention(text, text.length)).toBeNull();
  });

  it('does not match when the caret is not at the end of the token', () => {
    const text = '@alice extra';
    expect(detectMention(text, text.length)).toBeNull();
  });

  it('suppresses mentions inside an attachment token', () => {
    const text = `${imageToken(1, '@shot.png')}`;
    // caret right after the "@" inside the token span
    const caret = text.indexOf('@') + 1;
    expect(detectMention(text, caret)).toBeNull();
  });
});

describe('mentionables', () => {
  const minds = [makeMind('m1', 'Ada'), makeMind('m2', 'Alan'), makeMind('m3', 'Grace')];

  it('maps minds to id/name pairs', () => {
    expect(toMentionables(minds)).toEqual([
      { mindId: 'm1', name: 'Ada' },
      { mindId: 'm2', name: 'Alan' },
      { mindId: 'm3', name: 'Grace' },
    ]);
  });

  it('returns everything (capped) for an empty query', () => {
    expect(filterMentionables(toMentionables(minds), '')).toHaveLength(3);
  });

  it('filters case-insensitively by substring', () => {
    const result = filterMentionables(toMentionables(minds), 'a');
    expect(result.map((m) => m.name)).toEqual(['Ada', 'Alan', 'Grace']);
    const al = filterMentionables(toMentionables(minds), 'al');
    expect(al.map((m) => m.name)).toEqual(['Alan']);
  });

  it('honours the result limit', () => {
    const many = Array.from({ length: 20 }, (_, i) => makeMind(`m${i}`, `Agent${i}`));
    expect(filterMentionables(toMentionables(many), 'agent', 5)).toHaveLength(5);
  });
});

describe('detectSlash', () => {
  it('matches a bare slash and a partial command', () => {
    expect(detectSlash('/')).toEqual({ query: '' });
    expect(detectSlash('/ne')).toEqual({ query: 'ne' });
  });

  it('does not match once a space or newline is typed', () => {
    expect(detectSlash('/new ')).toBeNull();
    expect(detectSlash('hello /new')).toBeNull();
  });

  it('filters commands by id prefix', () => {
    expect(filterSlashCommands(SLASH_COMMANDS, '')).toHaveLength(SLASH_COMMANDS.length);
    expect(filterSlashCommands(SLASH_COMMANDS, 'cl').map((c) => c.id)).toEqual(['clear']);
    expect(filterSlashCommands(SLASH_COMMANDS, 'zzz')).toHaveLength(0);
  });
});

describe('file classification', () => {
  it('treats image mime types and image extensions as images', () => {
    expect(isImageFile({ name: 'x', mimeType: 'image/png' })).toBe(true);
    expect(isImageFile({ name: 'photo.JPG', mimeType: '' })).toBe(true);
    expect(isImageFile({ name: 'notes.txt', mimeType: 'text/plain' })).toBe(false);
  });

  it('treats text mime types and known code extensions as text-like', () => {
    expect(isTextLikeFile({ name: 'a.txt', mimeType: 'text/plain' })).toBe(true);
    expect(isTextLikeFile({ name: 'a.ts', mimeType: '' })).toBe(true);
    expect(isTextLikeFile({ name: 'data.json', mimeType: 'application/json' })).toBe(true);
    expect(isTextLikeFile({ name: 'feed.atom', mimeType: 'application/atom+xml' })).toBe(true);
    expect(isTextLikeFile({ name: 'archive.zip', mimeType: 'application/zip' })).toBe(false);
  });
});

describe('safeFenceFor', () => {
  it('uses three backticks when content has no fence', () => {
    expect(safeFenceFor('plain text')).toBe('```');
  });

  it('grows the fence beyond the longest backtick run in the content', () => {
    expect(safeFenceFor('a ``` b')).toBe('````');
    expect(safeFenceFor('a ````` b')).toBe('``````');
  });
});

describe('buildMessageWithTextAttachments', () => {
  it('returns the input unchanged when there are no text attachments', () => {
    expect(buildMessageWithTextAttachments('hi', [])).toBe('hi');
  });

  it('folds contents of attachments whose token id is present', () => {
    const input = `look at ${fileToken(5, 'notes.md')}`;
    const out = buildMessageWithTextAttachments(input, [
      { id: 5, name: 'notes.md', mimeType: 'text/markdown', content: '# Title' },
    ]);
    expect(out).toContain(`look at ${fileToken(5, 'notes.md')}`);
    expect(out).toContain('Attached file notes.md:');
    expect(out).toContain('# Title');
  });

  it('ignores attachments whose token id is not in the input', () => {
    const out = buildMessageWithTextAttachments('no tokens here', [
      { id: 5, name: 'notes.md', mimeType: 'text/markdown', content: '# Title' },
    ]);
    expect(out).toBe('no tokens here');
  });

  it('uses a fence long enough to wrap content that itself contains fences', () => {
    const input = fileToken(1, 'snippet.md');
    const out = buildMessageWithTextAttachments(input, [
      { id: 1, name: 'snippet.md', mimeType: 'text/markdown', content: 'text\n```\ncode\n```' },
    ]);
    expect(out).toContain('````\ntext');
  });
});
