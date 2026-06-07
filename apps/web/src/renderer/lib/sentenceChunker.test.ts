import { describe, it, expect } from 'vitest';
import { splitIntoSentences, stripSpeechMarkup } from './sentenceChunker';

describe('splitIntoSentences', () => {
  it('returns no sentences for an unterminated fragment', () => {
    const result = splitIntoSentences('Hello there');
    expect(result.sentences).toEqual([]);
    expect(result.rest).toBe('Hello there');
  });

  it('extracts a single completed sentence and buffers the rest', () => {
    const result = splitIntoSentences('Hello there. How are');
    expect(result.sentences).toEqual(['Hello there.']);
    expect(result.rest).toBe('How are');
  });

  it('extracts multiple sentences across punctuation kinds', () => {
    const result = splitIntoSentences('One. Two! Three? Four');
    expect(result.sentences).toEqual(['One.', 'Two!', 'Three?']);
    expect(result.rest).toBe('Four');
  });

  it('keeps a terminator at the very end buffered (no trailing whitespace)', () => {
    const result = splitIntoSentences('The value is 3.14');
    expect(result.sentences).toEqual([]);
    expect(result.rest).toBe('The value is 3.14');
  });

  it('does not split a decimal mid-number', () => {
    const result = splitIntoSentences('Pi is 3.14 and that matters. Next');
    expect(result.sentences).toEqual(['Pi is 3.14 and that matters.']);
    expect(result.rest).toBe('Next');
  });

  it('treats newlines as a boundary', () => {
    const result = splitIntoSentences('First line\nSecond line\nthird');
    expect(result.sentences).toEqual(['First line', 'Second line']);
    expect(result.rest).toBe('third');
  });

  it('includes a trailing closing quote with the sentence', () => {
    const result = splitIntoSentences('She said "go." Then left');
    expect(result.sentences).toEqual(['She said "go."']);
    expect(result.rest).toBe('Then left');
  });

  it('handles an ellipsis terminator', () => {
    const result = splitIntoSentences('Wait… really');
    expect(result.sentences).toEqual(['Wait…']);
    expect(result.rest).toBe('really');
  });

  it('collapses consecutive newlines into a single boundary', () => {
    const result = splitIntoSentences('Para one\n\nPara two\n\n');
    expect(result.sentences).toEqual(['Para one', 'Para two']);
    expect(result.rest).toBe('');
  });

  it('drops whitespace-only segments between boundaries', () => {
    const result = splitIntoSentences('Done.   \nNext one. tail');
    expect(result.sentences).toEqual(['Done.', 'Next one.']);
    expect(result.rest).toBe('tail');
  });
});

describe('stripSpeechMarkup', () => {
  it('removes emphasis and heading markers', () => {
    expect(stripSpeechMarkup('# Title with **bold** and _italic_')).toBe('Title with bold and italic');
  });

  it('unwraps inline code and link text', () => {
    expect(stripSpeechMarkup('Run `npm test` then see [the docs](https://x.y)')).toBe('Run npm test then see the docs');
  });

  it('strips fenced code blocks and collapses whitespace', () => {
    expect(stripSpeechMarkup('Before\n```\ncode here\n```\nafter')).toBe('Before after');
  });

  it('drops image syntax', () => {
    expect(stripSpeechMarkup('Look ![alt](img.png) here')).toBe('Look here');
  });
});
