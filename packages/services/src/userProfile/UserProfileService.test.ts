import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConfigService } from '../config';
import { UserProfileService } from './UserProfileService';

describe('UserProfileService', () => {
  it('returns a default local profile when none is persisted', () => {
    const fixture = createFixture();
    try {
      expect(fixture.service.getProfile()).toEqual({
        displayName: '',
        work: '',
        location: '',
        about: '',
        avatarDataUrl: null,
        source: 'local',
        updatedAt: null,
      });
    } finally {
      fixture.dispose();
    }
  });

  it('saves editable local profile fields', () => {
    const fixture = createFixture();
    try {
      const profile = fixture.service.saveProfile({
        displayName: 'Ian Philpot',
        work: 'Principal SWE Manager',
        location: 'Atlanta',
        about: 'Builds Chamber.',
        avatarDataUrl: 'data:image/png;base64,avatar',
      });

      expect(profile).toMatchObject({
        displayName: 'Ian Philpot',
        work: 'Principal SWE Manager',
        location: 'Atlanta',
        about: 'Builds Chamber.',
        avatarDataUrl: 'data:image/png;base64,avatar',
        source: 'local',
      });
      expect(fixture.service.getProfile()).toEqual(profile);
    } finally {
      fixture.dispose();
    }
  });

  it('applies partial updates without clearing untouched fields', () => {
    const fixture = createFixture();
    try {
      fixture.service.saveProfile({
        displayName: 'Ian Philpot',
        work: 'Principal SWE Manager',
        location: 'Atlanta',
      });

      const profile = fixture.service.saveProfile({ location: 'Remote' });

      expect(profile.displayName).toBe('Ian Philpot');
      expect(profile.work).toBe('Principal SWE Manager');
      expect(profile.location).toBe('Remote');
    } finally {
      fixture.dispose();
    }
  });

  it('recovers from malformed persisted profile data', () => {
    const fixture = createFixture();
    try {
      fs.mkdirSync(fixture.root, { recursive: true });
      fs.writeFileSync(path.join(fixture.root, 'config.json'), JSON.stringify({
        version: 2,
        minds: [],
        activeMindId: null,
        activeLogin: null,
        theme: 'dark',
        userProfile: 'broken',
      }));

      expect(fixture.service.getProfile()).toMatchObject({
        displayName: '',
        source: 'local',
      });
    } finally {
      fixture.dispose();
    }
  });

  it('marks imported Microsoft profiles with account metadata', () => {
    const fixture = createFixture();
    try {
      const profile = fixture.service.saveMicrosoftProfile({
        displayName: 'Ian Philpot',
        work: 'Principal SWE Manager',
        location: 'ATLANTA',
        avatarDataUrl: null,
        microsoftAccount: 'ianphil@microsoft.com',
      });

      expect(profile).toMatchObject({
        displayName: 'Ian Philpot',
        work: 'Principal SWE Manager',
        location: 'ATLANTA',
        source: 'microsoft',
        microsoftAccount: 'ianphil@microsoft.com',
      });
    } finally {
      fixture.dispose();
    }
  });
});

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-user-profile-'));
  const service = new UserProfileService(new ConfigService(root));
  return {
    root,
    service,
    dispose: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}
