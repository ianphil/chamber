/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { LensForm } from './LensForm';

describe('LensForm', () => {
  it('renders data keys as label-value pairs', () => {
    render(<LensForm data={{ agent: 'Q', status: 'online' }} />);
    expect(screen.getByText('Agent')).toBeTruthy();
    expect(screen.getByText('Q')).toBeTruthy();
  });

  it('uses schema titles when available', () => {
    render(<LensForm data={{ item_count: 42 }} schema={{ properties: { item_count: { title: 'Total Items' } } }} />);
    expect(screen.getByText('Total Items')).toBeTruthy();
  });

  it('handles arrays and objects', () => {
    render(<LensForm data={{ tags: ['a', 'b'], meta: { x: 1 } }} />);
    expect(screen.getByText('a, b')).toBeTruthy();
  });
});
