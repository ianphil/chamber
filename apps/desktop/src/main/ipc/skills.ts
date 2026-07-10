import { ipcMain } from 'electron';
import { z } from 'zod';
import { IPC, parseIpcArgs } from '@chamber/shared';
import type { SkillManifest } from '@chamber/shared';

const mindIdSchema = z.string().min(1, 'must be a non-empty string');

export interface SkillsIpcMindProvider {
  getMindPath(mindId: string): string | undefined;
}

export interface MindSkillDiscoveryPort {
  list(mindPath: string): Promise<SkillManifest[]>;
}

export function setupSkillsIPC(
  mindProvider: SkillsIpcMindProvider,
  discovery: MindSkillDiscoveryPort,
): void {
  ipcMain.handle(IPC.SKILLS.LIST_FOR_MIND, async (_event, rawMindId: unknown) => {
    const mindId = parseIpcArgs(IPC.SKILLS.LIST_FOR_MIND, mindIdSchema, rawMindId);
    const mindPath = mindProvider.getMindPath(mindId);
    if (!mindPath) return [];
    return discovery.list(mindPath);
  });
}
