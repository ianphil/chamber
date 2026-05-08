import type { AvatarPanelState } from './AgentAvatarPanel.logic';

const AVATAR_MODEL_URL = 'https://cdn.jsdelivr.net/gh/met4citizen/TalkingHead@1.7/avatars/brunette.glb';

interface TalkingHeadInstance {
  showAvatar(
    avatar: Record<string, unknown>,
    onProgress?: (event: ProgressEvent) => void,
  ): Promise<void>;
  setMood(mood: string, weight?: number): void;
  playGesture(name: string): void;
  speakText(text: string, options?: { ttsEndpoint?: string | null }): Promise<void>;
  stopSpeaking?: () => Promise<void> | void;
  dispose?: () => Promise<void> | void;
}

interface TalkingHeadConstructor {
  new(container: HTMLElement, options: Record<string, unknown>): TalkingHeadInstance;
}

export interface TalkingHeadAvatarController {
  setState(state: AvatarPanelState): void;
  speakText(text: string): void;
  dispose(): void;
}

export async function createTalkingHeadAvatar(
  container: HTMLElement,
  onProgress: (percent: number) => void,
): Promise<TalkingHeadAvatarController> {
  const moduleRecord: unknown = await import('@met4citizen/talkinghead');
  const TalkingHead = getTalkingHeadConstructor(moduleRecord);

  if (!TalkingHead) {
    throw new Error('TalkingHead module did not expose a TalkingHead constructor.');
  }

  const head = new TalkingHead(container, {
    lipsyncModules: ['en'],
    cameraView: 'mid',
    cameraDistance: 0,
    cameraRotateEnable: false,
    cameraZoomEnable: false,
    cameraPanEnable: false,
    lightAmbientColor: 0xffffff,
    lightAmbientIntensity: 2,
    lightDirectColor: 0x8888aa,
    lightDirectIntensity: 30,
    lightDirectPhi: 0.1,
    lightDirectTheta: 2,
    avatarMood: 'neutral',
    avatarIdleEyeContact: 0.4,
    avatarIdleHeadMove: 0.45,
    avatarSpeakingEyeContact: 0.7,
    avatarSpeakingHeadMove: 0.6,
    modelFPS: 30,
  });

  await head.showAvatar({
    url: AVATAR_MODEL_URL,
    body: 'F',
    avatarMood: 'neutral',
    lipsyncLang: 'en',
  }, (event) => {
    if (event.lengthComputable) {
      onProgress(Math.round((event.loaded / event.total) * 100));
    }
  });

  return createController(head);
}

function createController(head: TalkingHeadInstance): TalkingHeadAvatarController {
  let requestedState: AvatarPanelState = 'idle';
  let speechQueue: Promise<void> = Promise.resolve();
  let disposed = false;

  const applyState = (state: AvatarPanelState) => {
    if (disposed) return;

    switch (state) {
      case 'thinking':
        head.setMood('neutral');
        head.playGesture('thinking');
        break;
      case 'listening':
        head.setMood('happy', 0.3);
        break;
      case 'speaking':
        head.setMood('neutral');
        break;
      case 'idle':
      default:
        head.setMood('neutral');
        break;
    }
  };

  return {
    setState(state) {
      if (disposed) return;
      requestedState = state;
      applyState(state);
    },
    speakText(text) {
      if (disposed) return;

      const cleanText = text.trim();
      if (cleanText.length === 0) return;

      speechQueue = speechQueue
        .catch((error: unknown) => {
          console.warn('[avatar] Previous speech item failed:', error);
        })
        .then(async () => {
          if (disposed) return;
          applyState('speaking');
          try {
            await head.speakText(cleanText, { ttsEndpoint: null });
          } catch (error) {
            console.warn('[avatar] Silent lip-sync failed:', error);
          } finally {
            applyState(requestedState);
          }
        });

      void speechQueue;
    },
    dispose() {
      disposed = true;
      if (head.stopSpeaking) {
        void Promise.resolve(head.stopSpeaking()).catch((error: unknown) => {
          console.warn('[avatar] Failed to stop speaking:', error);
        });
      }
      if (head.dispose) {
        void Promise.resolve(head.dispose()).catch((error: unknown) => {
          console.warn('[avatar] Failed to dispose TalkingHead:', error);
        });
      }
    },
  };
}

function getTalkingHeadConstructor(moduleRecord: unknown): TalkingHeadConstructor | null {
  if (!isRecord(moduleRecord)) return null;
  const candidate = moduleRecord.TalkingHead;
  return typeof candidate === 'function' ? candidate as TalkingHeadConstructor : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
