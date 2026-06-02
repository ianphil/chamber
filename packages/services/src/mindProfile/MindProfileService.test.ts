import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MindProfileService } from './MindProfileService';
import { IdentityLoader } from '../chat/IdentityLoader';
import type { AvatarNormalizer, MindProfileMindProvider } from './types';

describe('MindProfileService', () => {
  it('reads local profile files and avatar data', () => {
    const { root, service } = createProfileFixture();
    try {
      fs.mkdirSync(path.join(root, '.chamber'), { recursive: true });
      fs.writeFileSync(path.join(root, '.chamber', 'avatar.png'), Buffer.from('avatar'));

      const profile = service.getProfile('mind-1');

      expect(profile.displayName).toBe('Moneypenny');
      expect(profile.soul.content).toContain('# Moneypenny');
      expect(profile.agentFiles[0]?.relativePath).toBe(path.join('.github', 'agents', 'moneypenny.agent.md'));
      expect(profile.avatarDataUrl).toContain('data:image/png;base64');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('rolls back a save that would make SOUL.md invalid', async () => {
    const { root, service } = createProfileFixture();
    try {
      const profile = service.getProfile('mind-1');

      const result = await service.saveFile({
        mindId: 'mind-1',
        kind: 'soul',
        relativePath: 'SOUL.md',
        content: 'no heading',
        expectedMtimeMs: profile.soul.mtimeMs,
      });

      expect(result.success).toBe(false);
      expect(fs.readFileSync(path.join(root, 'SOUL.md'), 'utf-8')).toContain('# Moneypenny');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects profile paths that escape the editable agent directory', async () => {
    const { root, service } = createProfileFixture();
    try {
      const result = await service.saveFile({
        mindId: 'mind-1',
        kind: 'agent',
        relativePath: '.github\\agents\\..\\..\\.working-memory\\outside.agent.md',
        content: '# Outside',
        expectedMtimeMs: null,
      });

      if (result.success) throw new Error('Expected path escape save to fail');
      expect(result.error).toContain('editable profile directory');
      expect(fs.existsSync(path.join(root, '.working-memory', 'outside.agent.md'))).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects symlinked profile files', async () => {
    const { root, service } = createProfileFixture();
    try {
      const outside = path.join(os.tmpdir(), `chamber-profile-outside-${Date.now()}.md`);
      const soulPath = path.join(root, 'SOUL.md');
      fs.writeFileSync(outside, '# Outside\n');
      fs.rmSync(soulPath);
      fs.symlinkSync(outside, soulPath, 'file');

      const result = await service.saveFile({
        mindId: 'mind-1',
        kind: 'soul',
        relativePath: 'SOUL.md',
        content: '# Updated\n',
        expectedMtimeMs: fs.lstatSync(soulPath).mtimeMs,
      });

      if (result.success) throw new Error('Expected symlink save to fail');
      expect(result.error).toContain('symlinks');
      expect(fs.readFileSync(outside, 'utf-8')).toBe('# Outside\n');
      fs.rmSync(outside, { force: true });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('uses the injected normalizer for avatar saves', async () => {
    const { root, service, normalizer } = createProfileFixture();
    try {
      await service.saveAvatar('mind-1', path.join(root, 'input.png'), {
        left: 0,
        top: 0,
        width: 10,
        height: 10,
      });

      expect(normalizer.called).toBe(true);
      expect(fs.existsSync(path.join(root, '.chamber', 'avatar.png'))).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('exposes dreamDaemonEnabled=false when no .chamber.json is present', () => {
    const { root, service } = createProfileFixture();
    try {
      const profile = service.getProfile('mind-1');
      expect(profile.dreamDaemonEnabled).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('exposes dreamDaemonEnabled=true when .chamber.json opts in to consolidation', () => {
    const { root, service } = createProfileFixture();
    try {
      fs.writeFileSync(
        path.join(root, '.chamber.json'),
        JSON.stringify({ workingMemory: { consolidation: { enabled: true } } }),
      );
      const profile = service.getProfile('mind-1');
      expect(profile.dreamDaemonEnabled).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  describe('feature-flag gate (dreamDaemonFeatureEnabled)', () => {
    // Mirrors IdentityLoader's gate: app-level flag is authoritative over
    // per-mind .chamber.json opt-in. When the flag is off, the profile
    // payload must report `dreamDaemonEnabled: false` so the (now-hidden)
    // toggle UI never sees a stale ON state.
    it('forces dreamDaemonEnabled=false even when .chamber.json says true and accessor returns false', () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-profile-'));
      try {
        fs.mkdirSync(path.join(root, '.github', 'agents'), { recursive: true });
        fs.writeFileSync(path.join(root, 'SOUL.md'), '# Moneypenny\n');
        fs.writeFileSync(
          path.join(root, '.chamber.json'),
          JSON.stringify({ workingMemory: { consolidation: { enabled: true } } }),
        );

        const provider: MindProfileMindProvider = {
          getMindPath: () => root,
          restartMind: async () => ({}),
        };
        const normalizer: AvatarNormalizer = {
          normalize: async ({ outputPath }) => {
            fs.mkdirSync(path.dirname(outputPath), { recursive: true });
            fs.writeFileSync(outputPath, Buffer.from('avatar'));
          },
        };
        const service = new MindProfileService(
          provider,
          new IdentityLoader(),
          normalizer,
          () => false,
        );

        const profile = service.getProfile('mind-1');
        expect(profile.dreamDaemonEnabled).toBe(false);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    it('honors .chamber.json enabled:true when the accessor returns true', () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-profile-'));
      try {
        fs.mkdirSync(path.join(root, '.github', 'agents'), { recursive: true });
        fs.writeFileSync(path.join(root, 'SOUL.md'), '# Moneypenny\n');
        fs.writeFileSync(
          path.join(root, '.chamber.json'),
          JSON.stringify({ workingMemory: { consolidation: { enabled: true } } }),
        );

        const provider: MindProfileMindProvider = {
          getMindPath: () => root,
          restartMind: async () => ({}),
        };
        const normalizer: AvatarNormalizer = {
          normalize: async ({ outputPath }) => {
            fs.mkdirSync(path.dirname(outputPath), { recursive: true });
            fs.writeFileSync(outputPath, Buffer.from('avatar'));
          },
        };
        const service = new MindProfileService(
          provider,
          new IdentityLoader(),
          normalizer,
          () => true,
        );

        const profile = service.getProfile('mind-1');
        expect(profile.dreamDaemonEnabled).toBe(true);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  });
});

function createProfileFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-profile-'));
  fs.mkdirSync(path.join(root, '.github', 'agents'), { recursive: true });
  fs.mkdirSync(path.join(root, '.working-memory'), { recursive: true });
  fs.writeFileSync(path.join(root, 'SOUL.md'), '# Moneypenny\n\nCalm and precise.');
  fs.writeFileSync(path.join(root, '.github', 'agents', 'moneypenny.agent.md'), '---\nname: Moneypenny\n---\n# Agent\n');
  fs.writeFileSync(path.join(root, '.working-memory', 'memory.md'), 'Memory');

  const provider: MindProfileMindProvider = {
    getMindPath: () => root,
    restartMind: async () => ({}),
  };
  const normalizer: AvatarNormalizer & { called: boolean } = {
    called: false,
    normalize: async ({ outputPath }) => {
      normalizer.called = true;
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, Buffer.from('avatar'));
    },
  };
  return { root, service: new MindProfileService(provider, new IdentityLoader(), normalizer), normalizer };
}
