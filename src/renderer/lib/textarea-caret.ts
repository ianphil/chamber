/**
 * Compute viewport-relative coordinates of the caret (or any selection
 * index) inside an HTMLTextAreaElement. Uses the standard "mirror div"
 * technique: render an off-screen <div> that copies the textarea's text
 * styling and content up to the caret, measure a marker span, then add
 * the textarea's bounding rect minus its scroll offset.
 *
 * Returns { top, left, height } in viewport (client) coordinates.
 */

const COPIED_PROPS = [
  'boxSizing',
  'width',
  'height',
  'overflowX',
  'overflowY',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'borderStyle',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'fontStyle',
  'fontVariant',
  'fontWeight',
  'fontStretch',
  'fontSize',
  'fontSizeAdjust',
  'lineHeight',
  'fontFamily',
  'textAlign',
  'textTransform',
  'textIndent',
  'textDecoration',
  'letterSpacing',
  'wordSpacing',
  'tabSize',
  'whiteSpace',
  'wordBreak',
  'overflowWrap',
] as const;

export interface CaretCoords {
  /** Viewport-relative top of the caret line. */
  top: number;
  /** Viewport-relative left of the caret. */
  left: number;
  /** Line height at the caret. */
  height: number;
}

export function getTextareaCaretCoords(
  textarea: HTMLTextAreaElement,
  position: number,
): CaretCoords {
  const doc = textarea.ownerDocument;
  if (!doc) return { top: 0, left: 0, height: 0 };

  const div = doc.createElement('div');
  doc.body.appendChild(div);

  const style = div.style;
  const computed = doc.defaultView?.getComputedStyle(textarea);

  style.position = 'absolute';
  style.top = '0';
  style.left = '0';
  style.visibility = 'hidden';
  style.whiteSpace = 'pre-wrap';
  style.wordWrap = 'break-word';
  style.overflow = 'hidden';

  if (computed) {
    for (const prop of COPIED_PROPS) {
      (style as unknown as Record<string, string>)[prop] = (computed as unknown as Record<string, string>)[prop];
    }
  }

  div.textContent = textarea.value.substring(0, position);
  // textarea-specific: long sequences of spaces stay collapsed otherwise.
  if (textarea.tagName.toLowerCase() === 'textarea') {
    div.textContent = div.textContent.replace(/\s/g, '\u00a0');
  }

  const span = doc.createElement('span');
  // Use a non-zero-width character so we get reliable measurements even at
  // end-of-string. The remaining text afterwards just provides line context.
  span.textContent = textarea.value.substring(position) || '.';
  div.appendChild(span);

  const rect = textarea.getBoundingClientRect();
  const lineHeight =
    span.offsetHeight ||
    parseFloat(computed?.lineHeight ?? '0') ||
    parseFloat(computed?.fontSize ?? '16');

  // Convert mirror coords (which are document-origin relative inside the mirror)
  // to viewport coords by adding the textarea's viewport position and
  // subtracting its internal scroll.
  const top = rect.top + span.offsetTop - textarea.scrollTop;
  const left = rect.left + span.offsetLeft - textarea.scrollLeft;

  doc.body.removeChild(div);

  return { top, left, height: lineHeight };
}
