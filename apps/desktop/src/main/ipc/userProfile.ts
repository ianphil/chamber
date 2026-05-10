import { ipcMain } from 'electron';
import { IPC } from '@chamber/shared';
import type { MicrosoftGraphProfileImporter, UserProfileService } from '@chamber/services';
import type { UserProfileSaveRequest } from '@chamber/shared/types';

export function setupUserProfileIPC(
  userProfileService: UserProfileService,
  microsoftGraphProfileImporter: MicrosoftGraphProfileImporter,
): void {
  ipcMain.handle(IPC.USER_PROFILE.GET, async () => userProfileService.getProfile());
  ipcMain.handle(IPC.USER_PROFILE.SAVE, async (_event, request: UserProfileSaveRequest) =>
    userProfileService.saveProfile(request),
  );
  ipcMain.handle(IPC.USER_PROFILE.IMPORT_FROM_MICROSOFT, async () =>
    microsoftGraphProfileImporter.importProfile(),
  );
}
