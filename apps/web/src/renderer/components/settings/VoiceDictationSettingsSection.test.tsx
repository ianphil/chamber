/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  VOICE_DICTATION_MODEL_ID,
  type VoiceDictationConfig,
  type VoiceModelStatus,
} from '@chamber/shared/voice-types';

import { VoiceDictationSettingsSection } from './VoiceDictationSettingsSection';
import { installElectronAPI, mockElectronAPI } from '../../../test/helpers';

function pointerCaptureShim() {
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', { configurable: true, value: vi.fn(() => false) });
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: vi.fn() });
  Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', { configurable: true, value: vi.fn() });
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
}

function createConfig(overrides: Partial<VoiceDictationConfig> = {}): VoiceDictationConfig {
  return {
    enabled: true,
    inputDeviceId: null,
    shortcut: 'Alt+Shift+V',
    pushToTalk: true,
    model: { id: VOICE_DICTATION_MODEL_ID },
    ...overrides,
  };
}

function installMediaDevices(
  devices: Array<Partial<MediaDeviceInfo> & Pick<MediaDeviceInfo, 'deviceId' | 'kind' | 'label'>> = [],
) {
  const enumerateDevices = vi.fn().mockResolvedValue(devices as MediaDeviceInfo[]);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { enumerateDevices },
  });
  return enumerateDevices;
}

describe('VoiceDictationSettingsSection', () => {
  let api: ReturnType<typeof mockElectronAPI>;

  beforeEach(() => {
    pointerCaptureShim();
    installMediaDevices();
    api = installElectronAPI();
    (api.voice.getConfig as ReturnType<typeof vi.fn>).mockResolvedValue(createConfig());
    (api.voice.getPermissionState as ReturnType<typeof vi.fn>).mockResolvedValue('granted');
    (api.voice.getModelStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: VOICE_DICTATION_MODEL_ID,
      status: 'not-downloaded',
      sizeBytes: 1_500_000_000,
    });
  });

  it('renders each settings row', async () => {
    render(<VoiceDictationSettingsSection />);

    expect(await screen.findByRole('heading', { name: /voice dictation/i })).toBeTruthy();
    expect(screen.getByText('Input device')).toBeTruthy();
    expect(screen.getByText('Microphone permissions')).toBeTruthy();
    expect(screen.getAllByText('Test mic').length).toBeGreaterThan(0);
    expect(screen.getByText('Shortcut')).toBeTruthy();
    expect(screen.getByText('Push-to-talk')).toBeTruthy();
    expect(screen.getByText('Transcription model')).toBeTruthy();
  });

  it('lists audio input devices from navigator.mediaDevices.enumerateDevices', async () => {
    installMediaDevices([
      { kind: 'audioinput', deviceId: 'mic-1', label: 'Studio Mic' },
      { kind: 'videoinput', deviceId: 'camera-1', label: 'Conference Camera' },
      { kind: 'audioinput', deviceId: 'mic-2', label: 'Headset Mic' },
    ]);

    render(<VoiceDictationSettingsSection />);

    await waitFor(() => {
      expect(navigator.mediaDevices.enumerateDevices).toHaveBeenCalled();
    });

    fireEvent.pointerDown(screen.getByRole('combobox', { name: /input device/i }), {
      button: 0,
      ctrlKey: false,
      pointerType: 'mouse',
    });

    const listbox = await screen.findByRole('listbox');
    expect(within(listbox).getByText('System default')).toBeTruthy();
    expect(within(listbox).getByText('Studio Mic')).toBeTruthy();
    expect(within(listbox).getByText('Headset Mic')).toBeTruthy();
    expect(within(listbox).queryByText('Conference Camera')).toBeNull();
  });

  it('shows a passing microphone test result', async () => {
    (api.voice.testMic as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      transcript: 'hello chamber',
    });
    render(<VoiceDictationSettingsSection />);

    fireEvent.click(await screen.findByRole('button', { name: 'Test mic' }));

    expect(await screen.findByText(/Microphone test passed: “hello chamber”/i)).toBeTruthy();
  });

  it('saves config when push-to-talk changes', async () => {
    render(<VoiceDictationSettingsSection />);

    const toggle = await screen.findByRole('switch', { name: 'Push-to-talk' });
    await waitFor(() => {
      expect(toggle.getAttribute('aria-checked')).toBe('true');
    });
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(api.voice.saveConfig).toHaveBeenCalledWith(expect.objectContaining({
        inputDeviceId: null,
        pushToTalk: false,
        shortcut: 'Alt+Shift+V',
      }));
    });
  });

  it('updates the model download progress bar from onModelProgress events', async () => {
    let emitProgress: ((status: VoiceModelStatus) => void) | null = null;
    (api.voice.getModelStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: VOICE_DICTATION_MODEL_ID,
      status: 'downloading',
      percent: 10,
    });
    (api.voice.onModelProgress as ReturnType<typeof vi.fn>).mockImplementation((callback: (status: VoiceModelStatus) => void) => {
      emitProgress = callback;
      return vi.fn();
    });

    render(<VoiceDictationSettingsSection />);

    expect(await screen.findByText('Downloading 10%')).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: /model download progress/i }).getAttribute('aria-valuenow')).toBe('10');

    act(() => {
      const progressCallback = emitProgress;
      if (!progressCallback) throw new Error('Expected onModelProgress callback to be registered');
      progressCallback({
        id: VOICE_DICTATION_MODEL_ID,
        status: 'downloading',
        percent: 64,
      });
    });

    expect(await screen.findByText('Downloading 64%')).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: /model download progress/i }).getAttribute('aria-valuenow')).toBe('64');
  });

  it('shows denied microphone permission state with preferences action', async () => {
    (api.voice.getPermissionState as ReturnType<typeof vi.fn>).mockResolvedValue('denied');

    render(<VoiceDictationSettingsSection />);

    expect(await screen.findByText('Denied')).toBeTruthy();
    expect(screen.getByRole('button', { name: /open preferences/i })).toBeTruthy();
  });
});
