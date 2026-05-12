/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { AppStateProvider } from '../../lib/store';
import { ViewRouter } from './ViewRouter';
import { installElectronAPI } from '../../../test/helpers';

describe('ViewRouter', () => {
  it('renders the Squad Room view', () => {
    installElectronAPI();

    render(
      <AppStateProvider testInitialState={{ activeView: 'squad' }}>
        <ViewRouter />
      </AppStateProvider>,
    );

    expect(screen.getByRole('heading', { name: 'Squad Room' })).toBeTruthy();
  });
});
