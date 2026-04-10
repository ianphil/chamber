/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LensStatusBoard } from './LensStatusBoard';

describe('LensStatusBoard', () => {
  it('renders card with name', () => {
    const data = [{ name: 'Web Server', status: 'running' }] as unknown as Record<string, unknown>;
    render(<LensStatusBoard data={data} />);
    expect(screen.getByText('Web Server')).toBeTruthy();
  });

  it('running/active/ok shows green dot 🟢', () => {
    const data = [{ name: 'Svc', status: 'running' }] as unknown as Record<string, unknown>;
    render(<LensStatusBoard data={data} />);
    expect(screen.getByText('🟢')).toBeTruthy();
  });

  it('error/fail shows red dot 🔴', () => {
    const data = [{ name: 'Svc', status: 'error' }] as unknown as Record<string, unknown>;
    render(<LensStatusBoard data={data} />);
    expect(screen.getByText('🔴')).toBeTruthy();
  });

  it('warn/pending shows yellow dot 🟡', () => {
    const data = [{ name: 'Svc', status: 'pending' }] as unknown as Record<string, unknown>;
    render(<LensStatusBoard data={data} />);
    expect(screen.getByText('🟡')).toBeTruthy();
  });

  it('shows status badge', () => {
    const data = [{ name: 'DB', status: 'active' }] as unknown as Record<string, unknown>;
    render(<LensStatusBoard data={data} />);
    expect(screen.getByText('active')).toBeTruthy();
  });

  it('shows up to 3 metadata fields', () => {
    const data = [{
      name: 'API',
      status: 'ok',
      region: 'us-east',
      version: '2.1',
      uptime: '99.9%',
      extra: 'hidden',
    }] as unknown as Record<string, unknown>;
    render(<LensStatusBoard data={data} />);
    expect(screen.getByText(/Region/)).toBeTruthy();
    expect(screen.getByText(/Version/)).toBeTruthy();
    expect(screen.getByText(/Uptime/)).toBeTruthy();
    // 4th field should not appear
    expect(screen.queryByText(/Extra/)).toBeNull();
  });
});
