/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { AmbientCanvas } from './AmbientCanvas';

describe('AmbientCanvas', () => {
  it('renders a decorative canvas without WebGL (jsdom fallback path)', () => {
    // jsdom has no WebGL context, so getContext returns null and the
    // component takes its no-op fallback path. It must still mount the
    // canvas (transparent) so the CSS gradient shows through, and must
    // not throw.
    const { container, unmount } = render(<AmbientCanvas />);
    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();
    expect(canvas?.getAttribute('aria-hidden')).toBe('true');
    expect(() => unmount()).not.toThrow();
  });
});
