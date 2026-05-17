/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

import { LocalLlmSettingsSection } from './LocalLlmSettingsSection';
import { installElectronAPI, mockElectronAPI } from '../../../test/helpers';

function pointerCaptureShim() {
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', { configurable: true, value: vi.fn(() => false) });
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: vi.fn() });
  Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', { configurable: true, value: vi.fn() });
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
}

describe('LocalLlmSettingsSection', () => {
  let api: ReturnType<typeof mockElectronAPI>;

  beforeEach(() => {
    pointerCaptureShim();
    api = installElectronAPI();
  });

  async function enableByoForm(endpoint = 'https://example.com/v1') {
    fireEvent.click(await screen.findByLabelText('Enable BYO LLM'));
    fireEvent.change(screen.getByLabelText('Endpoint URL'), { target: { value: endpoint } });
  }

  it('BVT-LL01: renders disabled state when no saved config', async () => {
    (api.byoLlm.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    render(<LocalLlmSettingsSection />);
    await waitFor(() => {
      expect(screen.getByText(/Currently disabled/i)).toBeTruthy();
    });
    expect(screen.getByRole('switch', { name: 'Enable BYO LLM' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByLabelText('Endpoint URL')).toBeNull();
    expect(screen.getByText(/BYO fields are hidden/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Test connection/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Apply/i })).toBeNull();
  });

  it('BVT-LL02: shows Active row when saved config is enabled', async () => {
    (api.byoLlm.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      enabled: true,
      baseUrl: 'https://example.com/v1',
      model: 'gemma-4-e4b',
    });
    render(<LocalLlmSettingsSection />);
    await waitFor(() => {
      expect(screen.getByText(/Active:/i)).toBeTruthy();
      expect(screen.getByText('gemma-4-e4b')).toBeTruthy();
    });
    expect(screen.getByRole('switch', { name: 'Enable BYO LLM' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByLabelText('Endpoint URL')).toBeTruthy();
  });

  it('BVT-LL03: probe success surfaces a model-count message and enables Apply', async () => {
    (api.byoLlm.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (api.byoLlm.probe as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      modelCount: 4,
      models: [{ id: 'gemma-4-e4b' }, { id: 'qwen3.5-9b' }, { id: 'gemma-4-26b' }, { id: 'embedding' }],
    });
    render(<LocalLlmSettingsSection />);

    await enableByoForm();
    fireEvent.click(screen.getByRole('button', { name: /Test connection/i }));

    await waitFor(() => {
      expect(screen.getByText(/Found 4 models/i)).toBeTruthy();
    });
    expect((screen.getByRole('button', { name: /Apply/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('BVT-LL04: probe failure surfaces an error and Apply stays disabled', async () => {
    (api.byoLlm.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (api.byoLlm.probe as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: 'Endpoint returned HTTP 502',
    });
    render(<LocalLlmSettingsSection />);

    await enableByoForm();
    fireEvent.click(screen.getByRole('button', { name: /Test connection/i }));

    await waitFor(() => {
      expect(screen.getByText(/Endpoint returned HTTP 502/i)).toBeTruthy();
    });
    expect((screen.getByRole('button', { name: /Apply/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('BVT-LL05: keeps the probed model dropdown visible after selecting a model', async () => {
    (api.byoLlm.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (api.byoLlm.probe as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true, modelCount: 2, models: [{ id: 'm1' }, { id: 'm2' }],
    });
    render(<LocalLlmSettingsSection />);

    await enableByoForm();
    fireEvent.click(screen.getByRole('button', { name: /Test connection/i }));
    await screen.findByText(/Found 2 models/i);

    await waitFor(() => {
      const defaultModel = screen.getByLabelText('Default model') as HTMLSelectElement;
      expect(defaultModel.tagName).toBe('SELECT');
      expect(defaultModel.value).toBe('m1');
    });

    fireEvent.change(screen.getByLabelText('Default model'), { target: { value: 'm2' } });

    const defaultModel = screen.getByLabelText('Default model') as HTMLSelectElement;
    expect(defaultModel.tagName).toBe('SELECT');
    expect(defaultModel.value).toBe('m2');
    expect(screen.getByText(/Found 2 models/i)).toBeTruthy();
  });

  it('BVT-LL06: toggle off plus Apply disables BYO and refreshes affected agents', async () => {
    (api.byoLlm.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      enabled: true,
      baseUrl: 'https://example.com/v1',
      model: 'gemma',
    });
    (api.byoLlm.disable as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true });
    (api.byoLlm.restartAgents as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true, restartedCount: 1 });
    render(<LocalLlmSettingsSection />);

    await waitFor(() => screen.getByText(/Active:/i));
    fireEvent.click(screen.getByLabelText('Enable BYO LLM'));
    fireEvent.click(screen.getByRole('button', { name: /Apply/i }));

    await waitFor(() => {
      expect(api.byoLlm.disable).toHaveBeenCalled();
      expect(api.byoLlm.restartAgents).toHaveBeenCalled();
    });
    expect(screen.getByText(/BYO LLM disabled/i)).toBeTruthy();
  });

  it('BVT-LL07: invalid custom headers JSON blocks probing', async () => {
    (api.byoLlm.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (api.byoLlm.probe as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true, modelCount: 1, models: [{ id: 'm' }],
    });
    render(<LocalLlmSettingsSection />);

    await enableByoForm();
    fireEvent.change(screen.getByLabelText('Custom headers JSON'), { target: { value: '{ broken json' } });
    fireEvent.click(screen.getByRole('button', { name: /Test connection/i }));

    await waitFor(() => {
      expect(screen.getByText(/Invalid JSON/i)).toBeTruthy();
    });
    expect(api.byoLlm.probe).not.toHaveBeenCalled();
  });

  it('BVT-LL08: Apply calls byoLlm.save then byoLlm.restartAgents', async () => {
    (api.byoLlm.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (api.byoLlm.probe as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true, modelCount: 2, models: [{ id: 'm1' }, { id: 'm2' }],
    });
    (api.byoLlm.save as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true });
    (api.byoLlm.restartAgents as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true, restartedCount: 1 });
    render(<LocalLlmSettingsSection />);

    await enableByoForm();
    fireEvent.click(screen.getByRole('button', { name: /Test connection/i }));
    await screen.findByText(/Found 2 models/i);
    await waitFor(() => expect((screen.getByLabelText('Default model') as HTMLSelectElement).value).toBe('m1'));

    fireEvent.click(screen.getByRole('button', { name: /Apply/i }));

    await waitFor(() => {
      expect(api.byoLlm.save).toHaveBeenCalledWith(expect.objectContaining({
        enabled: true,
        baseUrl: 'https://example.com/v1',
        model: 'm1',
      }));
      expect(api.byoLlm.restartAgents).toHaveBeenCalled();
    });
  });

  it('BVT-LL09: changing endpoint after a probe invalidates Apply until re-tested', async () => {
    (api.byoLlm.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (api.byoLlm.probe as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true, modelCount: 1, models: [{ id: 'm1' }],
    });
    render(<LocalLlmSettingsSection />);

    await enableByoForm();
    fireEvent.click(screen.getByRole('button', { name: /Test connection/i }));
    await screen.findByText(/Found 1 model/i);
    expect((screen.getByRole('button', { name: /Apply/i }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.change(screen.getByLabelText('Endpoint URL'), { target: { value: 'https://other.example/v1' } });

    expect(screen.queryByText(/Found 1 model/i)).toBeNull();
    expect((screen.getByRole('button', { name: /Apply/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('BVT-LL10: saves advanced provider fields', async () => {
    (api.byoLlm.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (api.byoLlm.probe as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true, modelCount: 1, models: [{ id: 'm1' }],
    });
    (api.byoLlm.save as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true });
    (api.byoLlm.restartAgents as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true, restartedCount: 1 });
    render(<LocalLlmSettingsSection />);

    await enableByoForm();
    fireEvent.change(screen.getByLabelText('Provider type'), { target: { value: 'azure' } });
    fireEvent.change(screen.getByLabelText('Bearer token'), { target: { value: 'token' } });
    fireEvent.click(screen.getByText('Advanced provider settings'));
    fireEvent.change(screen.getByLabelText('Wire API'), { target: { value: 'responses' } });
    fireEvent.change(screen.getByLabelText('Azure API version'), { target: { value: '2024-10-21' } });
    fireEvent.change(screen.getByLabelText('Max prompt tokens'), { target: { value: '131072' } });
    fireEvent.change(screen.getByLabelText('Max output tokens'), { target: { value: '4096' } });
    fireEvent.change(screen.getByLabelText('Custom headers JSON'), { target: { value: '{ "X-Test": "yes" }' } });

    fireEvent.click(screen.getByRole('button', { name: /Test connection/i }));
    await screen.findByText(/Found 1 model/i);
    await waitFor(() => expect((screen.getByLabelText('Default model') as HTMLSelectElement).value).toBe('m1'));
    fireEvent.click(screen.getByRole('button', { name: /Apply/i }));

    await waitFor(() => {
      expect(api.byoLlm.save).toHaveBeenCalledWith(expect.objectContaining({
        enabled: true,
        baseUrl: 'https://example.com/v1',
        providerType: 'azure',
        bearerToken: 'token',
        model: 'm1',
        wireApi: 'responses',
        azureApiVersion: '2024-10-21',
        maxPromptTokens: 131072,
        maxOutputTokens: 4096,
        customHeaders: { 'X-Test': 'yes' },
      }));
    });
  });
});
