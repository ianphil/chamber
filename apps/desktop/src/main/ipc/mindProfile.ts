import { BrowserWindow, dialog, ipcMain } from 'electron';
import { getErrorMessage } from '@chamber/shared/getErrorMessage';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { MindProfileService, type MindManager } from '@chamber/services';
import type { AgentProfileAvatarSaveRequest, AgentProfileSaveRequest } from '@chamber/shared/types';
import type sharpModule from 'sharp';

const MAX_AVATAR_INPUT_BYTES = 10 * 1024 * 1024;
const MAX_INPUT_PIXELS = 24_000_000;
const AVATAR_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

export function setupMindProfileIPC(profileService: MindProfileService, mindManager: MindManager, sharp: typeof sharpModule): void {
  const avatarSources = new Map<string, string>();

  ipcMain.handle('mindProfile:get', async (_event, mindId: string) => {
    return profileService.getProfile(mindId);
  });

  ipcMain.handle('mindProfile:saveFile', async (_event, request: AgentProfileSaveRequest) => {
    return profileService.saveFile(request);
  });

  ipcMain.handle('mindProfile:pickAvatarImage', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return { success: false, error: 'No window available for image selection.' };

    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      title: 'Choose agent avatar',
      filters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, error: 'No image selected.' };
    }

    const inputPath = result.filePaths[0];
    try {
      validateAvatarInput(inputPath);
      const preview = await sharp(inputPath, { limitInputPixels: MAX_INPUT_PIXELS })
        .rotate()
        .png()
        .toBuffer({ resolveWithObject: true });
      if (!preview.info.width || !preview.info.height) throw new Error('Selected file is not a valid image.');
      const sourceId = randomUUID();
      avatarSources.set(sourceId, inputPath);
      return {
        success: true,
        source: {
          sourceId,
          dataUrl: `data:image/png;base64,${preview.data.toString('base64')}`,
          width: preview.info.width,
          height: preview.info.height,
        },
      };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  });

  ipcMain.handle('mindProfile:saveAvatar', async (_event, request: AgentProfileAvatarSaveRequest) => {
    const inputPath = avatarSources.get(request.sourceId);
    if (!inputPath) return { success: false, error: 'Avatar source expired. Choose the image again.' };
    validateAvatarInput(inputPath);
    const result = await profileService.saveAvatar(request.mindId, inputPath, request.crop);
    avatarSources.delete(request.sourceId);
    return result;
  });

  ipcMain.handle('mindProfile:removeAvatar', async (_event, mindId: string) => {
    return profileService.removeAvatar(mindId);
  });

  ipcMain.handle('mindProfile:restart', async (_event, mindId: string) => {
    return mindManager.reloadMind(mindId);
  });
}

function validateAvatarInput(inputPath: string): void {
  const extension = path.extname(inputPath).toLowerCase();
  if (!AVATAR_EXTENSIONS.has(extension)) {
    throw new Error('Avatar must be a PNG, JPG, or WebP image.');
  }
  const stat = fs.statSync(inputPath);
  if (!stat.isFile()) throw new Error('Avatar source must be a file.');
  if (stat.size > MAX_AVATAR_INPUT_BYTES) {
    throw new Error('Avatar image must be 10 MB or smaller.');
  }
}
