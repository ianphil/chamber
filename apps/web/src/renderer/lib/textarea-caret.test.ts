/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { getTextareaCaretCoords } from './textarea-caret';

function makeTextarea(value: string): HTMLTextAreaElement {
  const ta = document.createElement('textarea');
  ta.value = value;
  document.body.appendChild(ta);
  return ta;
}

describe('getTextareaCaretCoords', () => {
  it('returns numeric {top,left,height} shape', () => {
    const ta = makeTextarea('hello world');
    const coords = getTextareaCaretCoords(ta, 5);
    expect(typeof coords.top).toBe('number');
    expect(typeof coords.left).toBe('number');
    expect(typeof coords.height).toBe('number');
    expect(Number.isFinite(coords.top)).toBe(true);
    expect(Number.isFinite(coords.left)).toBe(true);
    document.body.removeChild(ta);
  });

  it('subtracts textarea scrollTop from the result', () => {
    const ta = makeTextarea('a\n'.repeat(50));
    Object.defineProperty(ta, 'scrollTop', { configurable: true, value: 0 });
    const a = getTextareaCaretCoords(ta, 100);
    Object.defineProperty(ta, 'scrollTop', { configurable: true, value: 200 });
    const b = getTextareaCaretCoords(ta, 100);
    expect(b.top).toBe(a.top - 200);
    document.body.removeChild(ta);
  });

  it('subtracts textarea scrollLeft from the result', () => {
    const ta = makeTextarea('hello world');
    Object.defineProperty(ta, 'scrollLeft', { configurable: true, value: 0 });
    const a = getTextareaCaretCoords(ta, 5);
    Object.defineProperty(ta, 'scrollLeft', { configurable: true, value: 50 });
    const b = getTextareaCaretCoords(ta, 5);
    expect(b.left).toBe(a.left - 50);
    document.body.removeChild(ta);
  });

  it('cleans up the mirror div', () => {
    const ta = makeTextarea('hello');
    const beforeChildCount = document.body.children.length;
    getTextareaCaretCoords(ta, 3);
    expect(document.body.children.length).toBe(beforeChildCount);
    document.body.removeChild(ta);
  });
});
