/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LensTable } from './LensTable';

describe('LensTable', () => {
  it('renders single object as one-row table', () => {
    const data = { name: 'Alice', role: 'admin' } as Record<string, unknown>;
    render(<LensTable data={data} />);
    expect(screen.getByText('Alice')).toBeTruthy();
    expect(screen.getByText('admin')).toBeTruthy();
    // Should have table headers
    expect(screen.getByText('Name')).toBeTruthy();
    expect(screen.getByText('Role')).toBeTruthy();
  });

  it('renders array data as multiple rows', () => {
    const data = [
      { name: 'Alice', role: 'admin' },
      { name: 'Bob', role: 'user' },
    ] as unknown as Record<string, unknown>;
    render(<LensTable data={data} />);
    expect(screen.getByText('Alice')).toBeTruthy();
    expect(screen.getByText('Bob')).toBeTruthy();
  });

  it('derives columns from schema when present', () => {
    const data = [{ name: 'Alice', role: 'admin', extra: 'ignored' }] as unknown as Record<string, unknown>;
    const schema = { items: { properties: { name: { title: 'Full Name' }, role: { title: 'User Role' } } } };
    render(<LensTable data={data} schema={schema} />);
    expect(screen.getByText('Full Name')).toBeTruthy();
    expect(screen.getByText('User Role')).toBeTruthy();
  });

  it('derives columns from first row data keys', () => {
    const data = [{ alpha: 1, beta: 2 }] as unknown as Record<string, unknown>;
    render(<LensTable data={data} />);
    expect(screen.getByText('Alpha')).toBeTruthy();
    expect(screen.getByText('Beta')).toBeTruthy();
  });

  it('shows "No data." for empty array', () => {
    const data = [] as unknown as Record<string, unknown>;
    render(<LensTable data={data} />);
    expect(screen.getByText('No data.')).toBeTruthy();
  });
});
