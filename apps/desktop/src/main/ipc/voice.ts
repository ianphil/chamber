import { ipcMain } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { VoiceRecognitionResult, VoiceSynthesisResult } from '@chamber/shared/types';

const DEFAULT_RECOGNITION_LANGUAGE = 'en-US';
const DEFAULT_RECOGNITION_TIMEOUT_MS = 30_000;
const DEFAULT_VOICE_NAME = 'en-US-EmmaMultilingualNeural';

let activeRecognitionProcess: ChildProcessWithoutNullStreams | null = null;

export function setupVoiceIPC(): void {
  ipcMain.handle('voice:recognizeOnce', async (_event, options?: {
    language?: string;
    timeoutMs?: number;
  }): Promise<VoiceRecognitionResult> => {
    return recognizeWithWindowsSpeech({
      language: options?.language ?? DEFAULT_RECOGNITION_LANGUAGE,
      timeoutMs: options?.timeoutMs ?? DEFAULT_RECOGNITION_TIMEOUT_MS,
    });
  });

  ipcMain.handle('voice:stopRecognition', async (): Promise<void> => {
    stopActiveRecognition();
  });

  ipcMain.handle('voice:synthesize', async (_event, text: string, options?: {
    voice?: string;
  }): Promise<VoiceSynthesisResult> => {
    return synthesizeWithEdgeTts(text, options?.voice ?? firstEnv('CHAMBER_TTS_VOICE', 'SPEECH_VOICE') ?? DEFAULT_VOICE_NAME);
  });
}

async function recognizeWithWindowsSpeech({
  language,
  timeoutMs,
}: {
  language: string;
  timeoutMs: number;
}): Promise<VoiceRecognitionResult> {
  if (process.platform !== 'win32') {
    return {
      provider: 'windows-system-speech',
      error: 'Local voice input currently uses Windows built-in speech recognition.',
    };
  }

  stopActiveRecognition();

  const script = createWindowsSpeechRecognitionScript(language, timeoutMs);
  const encoded = Buffer.from(script, 'utf16le').toString('base64');

  return new Promise((resolve) => {
    const child = spawn('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-EncodedCommand',
      encoded,
    ], {
      windowsHide: true,
    });

    activeRecognitionProcess = child;
    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });

    const timeout = setTimeout(() => {
      if (activeRecognitionProcess === child) stopActiveRecognition();
    }, timeoutMs + 5_000);

    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      if (activeRecognitionProcess === child) activeRecognitionProcess = null;

      if (signal) {
        resolve({ provider: 'windows-system-speech', error: 'Voice input was stopped.' });
        return;
      }

      if (code !== 0) {
        resolve({
          provider: 'windows-system-speech',
          error: stderr.trim() || `Windows speech recognition exited with code ${code}.`,
        });
        return;
      }

      resolve(parseRecognitionOutput(stdout, stderr));
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      if (activeRecognitionProcess === child) activeRecognitionProcess = null;
      resolve({
        provider: 'windows-system-speech',
        error: `Could not start Windows speech recognition: ${error.message}`,
      });
    });
  });
}

function stopActiveRecognition() {
  if (!activeRecognitionProcess) return;
  activeRecognitionProcess.kill();
  activeRecognitionProcess = null;
}

function parseRecognitionOutput(stdout: string, stderr: string): VoiceRecognitionResult {
  const output = stdout.trim();
  if (!output) {
    return {
      provider: 'windows-system-speech',
      error: stderr.trim() || 'No speech recognized. Try again after the listening indicator appears.',
    };
  }

  try {
    const parsed = JSON.parse(output) as { text?: string; confidence?: number; error?: string };
    return {
      provider: 'windows-system-speech',
      text: parsed.text,
      confidence: parsed.confidence,
      error: parsed.error,
    };
  } catch {
    return {
      provider: 'windows-system-speech',
      error: output,
    };
  }
}

function createWindowsSpeechRecognitionScript(language: string, timeoutMs: number): string {
  const safeLanguage = JSON.stringify(language);
  const safeTimeoutMs = Math.max(1_000, Math.min(timeoutMs, 60_000));

  return `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$recognizer = $null
try {
  $culture = [System.Globalization.CultureInfo]::GetCultureInfo(${safeLanguage})
  try {
    $recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine($culture)
  } catch {
    $recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine
  }
  $recognizer.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
  $recognizer.InitialSilenceTimeout = [TimeSpan]::FromSeconds(8)
  $recognizer.BabbleTimeout = [TimeSpan]::FromSeconds(8)
  $recognizer.EndSilenceTimeout = [TimeSpan]::FromMilliseconds(900)
  $recognizer.EndSilenceTimeoutAmbiguous = [TimeSpan]::FromMilliseconds(1200)
  $recognizer.SetInputToDefaultAudioDevice()
  $result = $recognizer.Recognize([TimeSpan]::FromMilliseconds(${safeTimeoutMs}))
  if ($result -and $result.Text) {
    [PSCustomObject]@{ text = $result.Text; confidence = $result.Confidence } | ConvertTo-Json -Compress
  } else {
    [PSCustomObject]@{ text = ''; error = 'No speech recognized. Try again after the listening indicator appears.' } | ConvertTo-Json -Compress
  }
} catch {
  [PSCustomObject]@{ text = ''; error = $_.Exception.Message } | ConvertTo-Json -Compress
} finally {
  if ($recognizer) { $recognizer.Dispose() }
}
`;
}

async function synthesizeWithEdgeTts(text: string, voice: string): Promise<VoiceSynthesisResult> {
  const cleanText = text.trim();
  if (!cleanText) {
    return { provider: 'edge-tts', error: 'No text provided for voice output.' };
  }

  try {
    const { Communicate } = await import('edge-tts-universal');
    const comm = new Communicate(cleanText, { voice });
    const chunks: Buffer[] = [];

    for await (const chunk of comm.stream()) {
      if (chunk.type === 'audio' && chunk.data) {
        chunks.push(Buffer.from(chunk.data));
      }
    }

    if (chunks.length === 0) {
      return { provider: 'edge-tts', error: 'No TTS audio was generated.' };
    }

    return {
      provider: 'edge-tts',
      audioBase64: Buffer.concat(chunks).toString('base64'),
      mimeType: 'audio/mpeg',
    };
  } catch (error) {
    return {
      provider: 'edge-tts',
      error: error instanceof Error ? error.message : 'Edge TTS failed.',
    };
  }
}

function firstEnv(...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}
