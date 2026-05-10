import * as fs from 'fs';
import * as path from 'path';
import type {
  AgentProfile,
  AgentProfileActionResult,
  AgentProfileAvatarCrop,
  AgentProfileFile,
  AgentProfileFileKind,
  AgentProfileSaveRequest,
  AgentProfileSaveResult,
} from '@chamber/shared/types';
import type { IdentityLoader } from '../chat/IdentityLoader';
import type { AvatarNormalizer, MindProfileMindProvider } from './types';

const AVATAR_RELATIVE_PATH = path.join('.chamber', 'avatar.png');
const MAX_PROFILE_FILE_BYTES = 512_000;

export class MindProfileService {
  constructor(
    private readonly minds: MindProfileMindProvider,
    private readonly identityLoader: IdentityLoader,
    private readonly avatarNormalizer: AvatarNormalizer,
  ) {}

  getProfile(mindId: string, needsRestart = false): AgentProfile {
    const mindPath = this.requireMindPath(mindId);
    const identity = this.identityLoader.load(mindPath);
    const displayName = identity?.name ?? path.basename(mindPath);
    const avatarPath = path.join(mindPath, AVATAR_RELATIVE_PATH);

    return {
      mindId,
      mindPath,
      displayName,
      folderName: path.basename(mindPath),
      avatarDataUrl: readAvatarDataUrl(avatarPath),
      soul: this.readProfileFile(mindPath, 'soul', 'SOUL.md'),
      agentFiles: this.listAgentFiles(mindPath),
      needsRestart,
    };
  }

  async saveFile(request: AgentProfileSaveRequest): Promise<AgentProfileSaveResult> {
    const mindPath = this.requireMindPath(request.mindId);
    let targetPath: string;
    try {
      targetPath = this.resolveProfileFilePath(mindPath, request.kind, request.relativePath);
      assertEditableProfilePath(mindPath, targetPath);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        profile: this.getProfile(request.mindId),
      };
    }
    const previous = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf-8') : null;
    const previousMtimeMs = statMtimeMs(targetPath);

    if (previousMtimeMs !== request.expectedMtimeMs) {
      return {
        success: false,
        error: 'This profile file changed on disk. Reload it before saving.',
        profile: this.getProfile(request.mindId),
      };
    }

    const validationError = validateProfileContent(request.kind, request.content);
    if (validationError) {
      return {
        success: false,
        error: validationError,
        profile: this.getProfile(request.mindId),
      };
    }

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    const tmpPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;

    try {
      fs.writeFileSync(tmpPath, request.content, 'utf-8');
      fs.renameSync(tmpPath, targetPath);

      if (!this.identityLoader.load(mindPath)) {
        throw new Error('Profile changes would leave the agent without a loadable identity.');
      }

      return {
        success: true,
        profile: this.getProfile(request.mindId, true),
        needsRestart: true,
      };
    } catch (error) {
      if (fs.existsSync(tmpPath)) fs.rmSync(tmpPath, { force: true });
      restorePrevious(targetPath, previous);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        profile: this.getProfile(request.mindId),
      };
    }
  }

  async saveAvatar(mindId: string, inputPath: string, crop: AgentProfileAvatarCrop): Promise<AgentProfileActionResult> {
    const mindPath = this.requireMindPath(mindId);
    const outputPath = path.join(mindPath, AVATAR_RELATIVE_PATH);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    await this.avatarNormalizer.normalize({ inputPath, outputPath, crop });
    return { success: true, profile: this.getProfile(mindId) };
  }

  removeAvatar(mindId: string): AgentProfileActionResult {
    const mindPath = this.requireMindPath(mindId);
    const avatarPath = path.join(mindPath, AVATAR_RELATIVE_PATH);
    if (fs.existsSync(avatarPath)) fs.rmSync(avatarPath, { force: true });
    return { success: true, profile: this.getProfile(mindId) };
  }

  async restart(mindId: string): Promise<unknown> {
    return this.minds.restartMind(mindId);
  }

  private requireMindPath(mindId: string): string {
    const mindPath = this.minds.getMindPath(mindId);
    if (!mindPath) throw new Error(`Mind ${mindId} not found`);
    return path.resolve(mindPath);
  }

  private readProfileFile(mindPath: string, kind: AgentProfileFileKind, relativePath: string): AgentProfileFile {
    const filePath = this.resolveProfileFilePath(mindPath, kind, relativePath);
    const exists = fs.existsSync(filePath);
    let content = '';
    if (exists) {
      try {
        assertEditableProfilePath(mindPath, filePath);
        content = readBoundedText(filePath);
      } catch {
        content = '';
      }
    }
    return {
      kind,
      label: kind === 'soul' ? 'SOUL.md' : path.basename(relativePath),
      relativePath,
      content,
      exists,
      mtimeMs: statMtimeMs(filePath),
    };
  }

  private listAgentFiles(mindPath: string): AgentProfileFile[] {
    const agentsDir = path.join(mindPath, '.github', 'agents');
    if (!fs.existsSync(agentsDir)) {
      return [this.readProfileFile(mindPath, 'agent', path.join('.github', 'agents', 'agent.agent.md'))];
    }

    const agentFiles = fs.readdirSync(agentsDir)
      .map((file) => String(file))
      .filter((file) => file.endsWith('.agent.md'))
      .sort();

    if (agentFiles.length === 0) {
      return [this.readProfileFile(mindPath, 'agent', path.join('.github', 'agents', 'agent.agent.md'))];
    }

    return agentFiles.map((file) => this.readProfileFile(mindPath, 'agent', path.join('.github', 'agents', file)));
  }

  private resolveProfileFilePath(mindPath: string, kind: AgentProfileFileKind, relativePath: string): string {
    const normalizedRelative = relativePath.replaceAll('\\', path.sep).replaceAll('/', path.sep);
    const rawRelativeParts = normalizedRelative.split(path.sep);
    const normalizedPath = path.normalize(normalizedRelative);
    const relativeParts = normalizedPath.split(path.sep);
    const agentsRoot = path.resolve(mindPath, '.github', 'agents');

    if (path.isAbsolute(normalizedPath) || rawRelativeParts.includes('..') || relativeParts.includes('..')) {
      throw new Error('Profile path must stay inside the editable profile directory.');
    }
    if (kind === 'soul' && normalizedPath !== 'SOUL.md') {
      throw new Error('SOUL edits must target SOUL.md.');
    }
    if (kind === 'agent' && (path.dirname(normalizedPath) !== path.join('.github', 'agents') || !normalizedPath.endsWith('.agent.md'))) {
      throw new Error('Agent profile edits must target .github/agents/*.agent.md.');
    }

    const resolved = path.resolve(mindPath, normalizedPath);
    const root = `${path.resolve(mindPath)}${path.sep}`;
    if (!resolved.startsWith(root)) {
      throw new Error('Profile path escapes the mind directory.');
    }
    if (kind === 'agent' && path.dirname(resolved) !== agentsRoot) {
      throw new Error('Agent profile path escapes .github/agents.');
    }
    return resolved;
  }
}

function readBoundedText(filePath: string): string {
  const stat = fs.lstatSync(filePath);
  if (stat.size > MAX_PROFILE_FILE_BYTES) {
    throw new Error(`Profile file is too large to edit in Chamber: ${path.basename(filePath)}`);
  }
  return fs.readFileSync(filePath, 'utf-8');
}

function statMtimeMs(filePath: string): number | null {
  if (!fs.existsSync(filePath)) return null;
  return fs.lstatSync(filePath).mtimeMs;
}

function restorePrevious(targetPath: string, previous: string | null): void {
  if (previous === null) {
    if (fs.existsSync(targetPath)) fs.rmSync(targetPath, { force: true });
    return;
  }
  fs.writeFileSync(targetPath, previous, 'utf-8');
}

function validateProfileContent(kind: AgentProfileFileKind, content: string): string | null {
  if (!content.trim()) return 'Profile file cannot be empty.';
  if (kind === 'soul' && !/^#\s+.+/m.test(content)) {
    return 'SOUL.md must include a top-level heading with the agent name.';
  }
  return null;
}

function readAvatarDataUrl(avatarPath: string): string | null {
  if (!fs.existsSync(avatarPath)) return null;
  const data = fs.readFileSync(avatarPath);
  return `data:image/png;base64,${data.toString('base64')}`;
}

function assertEditableProfilePath(mindPath: string, targetPath: string): void {
  const root = path.resolve(mindPath);
  const relative = path.relative(root, targetPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Profile path escapes the mind directory.');
  }

  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) break;
    if (fs.lstatSync(current).isSymbolicLink()) {
      throw new Error('Profile files cannot be symlinks.');
    }
  }
}
