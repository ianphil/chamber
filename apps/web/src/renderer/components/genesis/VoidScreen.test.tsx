/**
 * @vitest-environment jsdom
 */
import React, { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { VoidScreen } from './VoidScreen';

vi.mock('./TypeWriter', () => ({
  TypeWriter: ({
    text,
    onComplete,
  }: {
    text: string;
    onComplete?: () => void;
  }) => {
    useEffect(() => {
      onComplete?.();
    }, [onComplete]);
    return <span>{text}</span>;
  },
}));

describe('VoidScreen', () => {
  afterEach(() => {
    cleanup();
  });

  it('adds a marketplace from the landing screen', async () => {
    const onAddMarketplace = vi.fn().mockResolvedValue({
      success: true,
      message: 'Added agency-microsoft/genesis-minds.',
    });

    render(<VoidScreen onBegin={vi.fn()} onAddMarketplace={onAddMarketplace} />);

    const addButton = await screen.findByText('Add Marketplace', undefined, { timeout: 8_000 });
    fireEvent.click(addButton);
    fireEvent.change(screen.getByLabelText('Marketplace repository URL'), {
      target: { value: 'https://github.com/agency-microsoft/genesis-minds' },
    });
    fireEvent.click(screen.getByText('Add marketplace'));

    await waitFor(() => {
      expect(onAddMarketplace).toHaveBeenCalledWith('https://github.com/agency-microsoft/genesis-minds');
    });
    expect((await screen.findByRole('status')).textContent).toBe('Added agency-microsoft/genesis-minds.');
  });

  it('shows friendly marketplace enrollment errors', async () => {
    const onAddMarketplace = vi.fn().mockResolvedValue({
      success: false,
      message: 'Check your GitHub sign-in or repository access.',
    });

    render(<VoidScreen onBegin={vi.fn()} onAddMarketplace={onAddMarketplace} />);

    fireEvent.click(await screen.findByText('Add Marketplace', undefined, { timeout: 8_000 }));
    fireEvent.change(screen.getByLabelText('Marketplace repository URL'), {
      target: { value: 'https://github.com/agency-microsoft/genesis-minds' },
    });
    fireEvent.click(screen.getByText('Add marketplace'));

    expect((await screen.findByRole('status')).textContent).toBe('Check your GitHub sign-in or repository access.');
  });
});
