// Streaming sentence chunker for text-to-speech.
//
// As an assistant reply streams in, we want to start speaking complete
// sentences before the whole message finishes. This splits an accumulating
// buffer into speakable sentences, keeping any trailing incomplete fragment
// buffered until the next delta (or a final flush) completes it.

export interface SentenceSplit {
  /** Complete, trimmed sentences ready to synthesize. */
  sentences: string[];
  /** Trailing text not yet terminated by punctuation or a newline. */
  rest: string;
}

// A boundary is either sentence-ending punctuation (optionally followed by a
// closing quote/bracket) trailed by whitespace, or one-or-more newlines. The
// trailing whitespace requirement means a terminator at the very end of the
// buffer (e.g. the "." in "3.14" mid-stream) stays buffered until we know what
// follows it.
const BOUNDARY = /[.!?…]['")\]]*\s|\n+/;

/**
 * Extract complete sentences from an accumulating text buffer.
 *
 * Punctuation-or-newline terminated runs become {@link SentenceSplit.sentences};
 * the unterminated tail is returned as {@link SentenceSplit.rest} for the caller
 * to carry forward and re-feed once more text arrives.
 */
export function splitIntoSentences(buffer: string): SentenceSplit {
  const sentences: string[] = [];
  let working = buffer;

  for (;;) {
    const match = BOUNDARY.exec(working);
    if (!match) break;
    const end = match.index + match[0].length;
    const sentence = working.slice(0, end).trim();
    if (sentence) sentences.push(sentence);
    working = working.slice(end);
  }

  return { sentences, rest: working };
}

/**
 * Strip Markdown markup that reads badly when spoken aloud (code fences,
 * emphasis markers, link/image syntax) and collapse whitespace. Returns plain
 * prose suitable for a neural TTS voice.
 */
export function stripSpeechMarkup(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')          // fenced code blocks
    .replace(/`([^`]+)`/g, '$1')              // inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')    // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')  // links -> link text
    .replace(/[*_~#>]/g, '')                  // emphasis / heading / quote markers
    .replace(/\s+/g, ' ')
    .trim();
}
