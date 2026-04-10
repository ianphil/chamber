/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LensBriefing } from './LensBriefing';

describe('LensBriefing', () => {
  it('renders cards for each data key', () => {
    const data = { inbox: 'empty', initiatives: '3 active' };
    render(<LensBriefing data={data} />);
    expect(screen.getByText('Inbox')).toBeTruthy();
    expect(screen.getByText('Initiatives')).toBeTruthy();
  });

  it('numbers display in large text', () => {
    const data = { count: 42 };
    render(<LensBriefing data={data} />);
    const el = screen.getByText('42');
    expect(el.className).toContain('text-2xl');
    expect(el.className).toContain('font-bold');
  });

  it('schema titles override key names', () => {
    const data = { foo: 'bar' };
    const schema = { properties: { foo: { title: 'Custom Title' } } };
    render(<LensBriefing data={data} schema={schema} />);
    expect(screen.getByText('Custom Title')).toBeTruthy();
  });

  it('arrays are joined with commas', () => {
    const data = { tags: ['a', 'b', 'c'] };
    render(<LensBriefing data={data} />);
    expect(screen.getByText('a, b, c')).toBeTruthy();
  });

  it('empty data renders no cards', () => {
    const { container } = render(<LensBriefing data={{}} />);
    expect(container.querySelectorAll('[class*="Card"]').length).toBe(0);
    expect(screen.queryByRole('heading')).toBeNull();
  });
});
