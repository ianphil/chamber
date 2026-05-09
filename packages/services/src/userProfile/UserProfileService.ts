import type { UserProfile, UserProfileSaveRequest } from '@chamber/shared/types';
import type { ConfigService } from '../config';

const DEFAULT_USER_PROFILE: UserProfile = {
  displayName: '',
  work: '',
  location: '',
  about: '',
  avatarDataUrl: null,
  source: 'local',
  updatedAt: null,
};

export class UserProfileService {
  constructor(private readonly configService: Pick<ConfigService, 'load' | 'save'>) {}

  getProfile(): UserProfile {
    return this.configService.load().userProfile ?? { ...DEFAULT_USER_PROFILE };
  }

  saveProfile(request: UserProfileSaveRequest): UserProfile {
    const config = this.configService.load();
    const profile: UserProfile = {
      ...(config.userProfile ?? DEFAULT_USER_PROFILE),
      ...definedProfileFields(request),
      source: 'local',
      updatedAt: new Date().toISOString(),
    };
    this.configService.save({ ...config, userProfile: profile });
    return profile;
  }

  saveMicrosoftProfile(request: UserProfileSaveRequest & { microsoftAccount?: string }): UserProfile {
    const config = this.configService.load();
    const profile: UserProfile = {
      ...(config.userProfile ?? DEFAULT_USER_PROFILE),
      ...definedProfileFields(request),
      source: 'microsoft',
      ...(request.microsoftAccount ? { microsoftAccount: request.microsoftAccount } : {}),
      updatedAt: new Date().toISOString(),
    };
    this.configService.save({ ...config, userProfile: profile });
    return profile;
  }
}

function definedProfileFields(request: UserProfileSaveRequest): UserProfileSaveRequest {
  const fields: UserProfileSaveRequest = {};
  if (request.displayName !== undefined) fields.displayName = request.displayName;
  if (request.work !== undefined) fields.work = request.work;
  if (request.location !== undefined) fields.location = request.location;
  if (request.about !== undefined) fields.about = request.about;
  if (request.avatarDataUrl !== undefined) fields.avatarDataUrl = request.avatarDataUrl;
  return fields;
}
