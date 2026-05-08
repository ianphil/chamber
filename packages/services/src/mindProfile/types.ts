import type { AgentProfileAvatarCrop } from '@chamber/shared/types';

export interface MindProfileMindProvider {
  getMindPath(mindId: string): string | null;
  restartMind(mindId: string): Promise<unknown>;
}

export interface AvatarNormalizeRequest {
  inputPath: string;
  outputPath: string;
  crop: AgentProfileAvatarCrop;
}

export interface AvatarNormalizer {
  normalize(request: AvatarNormalizeRequest): Promise<void>;
}
