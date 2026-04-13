/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LensTimeline } from './LensTimeline';

describe('LensTimeline', () => {
  it('renders timeline items', () => {
    const data = [
      { title: 'Deploy v1', time: '10:00' },
      { title: 'Deploy v2', time: '11:00' },
    ] as unknown as Record<string, unknown>;
    render(<LensTimeline data={data} />);
    expect(screen.getByText('Deploy v1')).toBeTruthy();
    expect(screen.getByText('Deploy v2')).toBeTruthy();
  });

  it('uses title field for entry title', () => {
    const data = [{ title: 'Release v3' }] as unknown as Record<string, unknown>;
    render(<LensTimeline data={data} />);
    expect(screen.getByText('Release v3')).toBeTruthy();
  });

  it('falls back to name, then event', () => {
    const data = [
      { name: 'Name Fallback' },
      { event: 'Event Fallback' },
    ] as unknown as Record<string, unknown>;
    render(<LensTimeline data={data} />);
    expect(screen.getByText('Name Fallback')).toBeTruthy();
    expect(screen.getByText('Event Fallback')).toBeTruthy();
  });

  it('renders time when present', () => {
    const data = [{ title: 'Item', time: '14:30 UTC' }] as unknown as Record<string, unknown>;
    render(<LensTimeline data={data} />);
    expect(screen.getByText('14:30 UTC')).toBeTruthy();
  });

  it('renders description when present', () => {
    const data = [{ title: 'Item', description: 'Something happened' }] as unknown as Record<string, unknown>;
    render(<LensTimeline data={data} />);
    expect(screen.getByText('Something happened')).toBeTruthy();
  });
});
