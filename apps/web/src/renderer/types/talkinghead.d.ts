declare module '@met4citizen/talkinghead' {
  export class TalkingHead {
    constructor(container: HTMLElement, options: Record<string, unknown>);

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
}
