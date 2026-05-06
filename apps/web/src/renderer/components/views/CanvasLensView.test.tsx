/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ElectronAPI } from '@chamber/shared/types';
import { CanvasLensView } from './CanvasLensView';

describe('CanvasLensView', () => {
  beforeEach(() => {
    window.electronAPI = {
      lens: {
        getCanvasUrl: vi.fn(async () => 'http://127.0.0.1:4312/mind-1/lens-abc.html'),
        getViewData: vi.fn(),
        getViews: vi.fn(),
        onViewsChanged: vi.fn(),
        refreshView: vi.fn(),
        sendAction: vi.fn(),
      },
    } as unknown as ElectronAPI;
  });

  it('renders Canvas Lens content in a sandboxed iframe', async () => {
    render(<CanvasLensView view={{
      icon: 'layout',
      id: 'command-center',
      name: 'Command Center',
      source: 'index.html',
      view: 'canvas',
    }} />);

    const iframe = await screen.findByTitle('Command Center');

    expect(iframe.getAttribute('src')).toBe('http://127.0.0.1:4312/mind-1/lens-abc.html');
    expect(iframe.getAttribute('sandbox')).toBe('allow-forms allow-same-origin allow-scripts');
  });

  it('refreshes the view before reloading the iframe url', async () => {
    render(<CanvasLensView view={{
      icon: 'layout',
      id: 'command-center',
      name: 'Command Center',
      prompt: 'Build the dashboard',
      source: 'index.html',
      view: 'canvas',
    }} />);

    await screen.findByTitle('Command Center');
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));

    await waitFor(() => {
      expect(window.electronAPI.lens.refreshView).toHaveBeenCalledWith('command-center');
      expect(window.electronAPI.lens.getCanvasUrl).toHaveBeenCalledTimes(2);
    });
  });
});
