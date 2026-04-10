/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LensDetail } from './LensDetail';

describe('LensDetail', () => {
  it('extracts title from data.name', () => {
    render(<LensDetail data={{ name: 'My Service' }} />);
    expect(screen.getByText('My Service')).toBeTruthy();
  });

  it('shows description', () => {
    render(<LensDetail data={{ name: 'Svc', description: 'A great service' }} />);
    expect(screen.getByText('A great service')).toBeTruthy();
  });

  it('shows status badge', () => {
    render(<LensDetail data={{ name: 'Svc', status: 'active' }} />);
    expect(screen.getByText('active')).toBeTruthy();
  });

  it('renders metadata key-value pairs', () => {
    render(<LensDetail data={{ name: 'Svc', region: 'us-west', version: '1.0' }} />);
    expect(screen.getByText('Region')).toBeTruthy();
    expect(screen.getByText('us-west')).toBeTruthy();
    expect(screen.getByText('Version')).toBeTruthy();
    expect(screen.getByText('1.0')).toBeTruthy();
  });
});
