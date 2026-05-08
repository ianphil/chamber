/** @vitest-environment jsdom */
import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { version } from '../../../../../../package.json';
import { ChamberLoadingScreen } from './ChamberLoadingScreen';

describe('ChamberLoadingScreen', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the app version from package.json during startup', () => {
    vi.useFakeTimers();

    render(<ChamberLoadingScreen />);

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(screen.getByText(`> chamber v${version}`)).toBeTruthy();
  });

  it('shows the app version from package.json while switching accounts', () => {
    vi.useFakeTimers();

    render(<ChamberLoadingScreen mode="switching-account" login="alice" />);

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(screen.getByText(`> chamber v${version}`)).toBeTruthy();
  });
});
