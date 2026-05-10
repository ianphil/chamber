import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

import * as fs from 'fs';
import { bootstrapMindCapabilities, installLensSkill, seedLensDefaults } from './MindBootstrap';

describe('seedLensDefaults', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates views when missing', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    seedLensDefaults('C:\\test\\mind');
    expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalled();
  });

  it('skips when views exist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    seedLensDefaults('C:\\test\\mind');
    expect(vi.mocked(fs.writeFileSync)).not.toHaveBeenCalled();
  });
});

describe('bootstrapMindCapabilities', () => {
  beforeEach(() => vi.clearAllMocks());

  it('seeds default lenses and installs the managed Lens skill', () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => String(p).includes('assets\\lens-skill\\SKILL.md'));
    vi.mocked(fs.readFileSync).mockReturnValue('---\nname: lens\nversion: 2.0.0\n---\n# Lens');

    bootstrapMindCapabilities('C:\\test\\mind');

    expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalledWith(
      expect.stringContaining('hello-world'),
      expect.any(String),
    );
    expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalledWith(
      expect.stringContaining('SKILL.md'),
      expect.stringContaining('# Lens'),
    );
  });
});

describe('installLensSkill', () => {
  beforeEach(() => vi.clearAllMocks());

  it('installs the bundled Lens skill with managed metadata when missing', () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => String(p).includes('assets\\lens-skill\\SKILL.md'));
    vi.mocked(fs.readFileSync).mockReturnValue('---\nname: lens\nversion: 2.0.0\n---\n# Lens');

    installLensSkill('C:\\test\\mind');

    expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalledWith(
      expect.stringContaining('SKILL.md'),
      expect.stringContaining('# Lens'),
    );
    expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalledWith(
      expect.stringContaining('.chamber-skill.json'),
      expect.stringContaining('"version": "2.0.0"'),
    );
  });

  it('installs the Lens skill from packaged Forge resources', () => {
    const previousResourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    Object.defineProperty(process, 'resourcesPath', {
      configurable: true,
      value: 'C:\\packed\\resources',
    });
    vi.mocked(fs.existsSync).mockImplementation((p) => String(p) === 'C:\\packed\\resources\\lens-skill\\SKILL.md');
    vi.mocked(fs.readFileSync).mockReturnValue('---\nname: lens\nversion: 2.0.0\n---\n# Packaged Lens');

    try {
      installLensSkill('C:\\test\\mind');
    } finally {
      Object.defineProperty(process, 'resourcesPath', {
        configurable: true,
        value: previousResourcesPath,
      });
    }

    expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalledWith(
      expect.stringContaining('SKILL.md'),
      expect.stringContaining('# Packaged Lens'),
    );
  });

  it('upgrades a managed unmodified Lens skill', () => {
    const oldContent = 'old managed content';
    const oldHash = '5b701009643e89a73dd2cbe5c2f56e819650c0aeac106ad1dfea77d60b526a22';
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync)
      .mockReturnValueOnce('new bundled content')
      .mockReturnValueOnce(oldContent)
      .mockReturnValueOnce(JSON.stringify({
        name: 'lens',
        version: '1.0.0',
        managedBy: 'chamber',
        contentSha256: oldHash,
        capabilities: ['lens-json'],
      }));

    installLensSkill('C:\\test\\mind');

    expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalledWith(
      expect.stringContaining('SKILL.md'),
      'new bundled content',
    );
  });

  it('upgrades legacy-looking unversioned Lens skills with a backup', () => {
    const legacySkill = [
      '---',
      'name: lens',
      'description: Create and manage Lens views',
      '---',
      '# Lens — Declarative UI Views',
      'Create `view.json` manifests in `.github/lens/<view-name>/` to add views.',
      '"view": "form | table | briefing"',
      '',
      'Local instruction: do not overwrite this customization.',
    ].join('\n');
    vi.mocked(fs.existsSync).mockImplementation((p) => !String(p).includes('legacy-backup'));
    vi.mocked(fs.readFileSync)
      .mockReturnValueOnce('new bundled content')
      .mockReturnValueOnce(legacySkill);

    installLensSkill('C:\\test\\mind');

    expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalledWith(
      expect.stringContaining('SKILL.legacy-backup.md'),
      legacySkill,
    );
    expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalledWith(
      expect.stringContaining('SKILL.md'),
      'new bundled content',
    );
  });

  it('upgrades compact legacy-looking unversioned Lens skills', () => {
    const legacySkill = [
      '---',
      'name: lens',
      'description: Create and manage Lens views',
      '---',
      '# Lens — Declarative UI Views',
      'Views live under .github/lens/<view-name>/view.json.',
      'The old contract supports form, table, and briefing panels.',
      'Local instruction: prefer concise panels.',
    ].join('\n');
    vi.mocked(fs.existsSync).mockImplementation((p) => !String(p).includes('legacy-backup'));
    vi.mocked(fs.readFileSync)
      .mockReturnValueOnce('new bundled content')
      .mockReturnValueOnce(legacySkill);

    installLensSkill('C:\\test\\mind');

    expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalledWith(
      expect.stringContaining('SKILL.md'),
      'new bundled content',
    );
  });

  it('preserves locally edited managed Lens skills', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync)
      .mockReturnValueOnce('new bundled content')
      .mockReturnValueOnce('locally edited content')
      .mockReturnValueOnce(JSON.stringify({
        name: 'lens',
        version: '1.0.0',
        managedBy: 'chamber',
        contentSha256: 'different',
        capabilities: ['lens-json'],
      }));

    installLensSkill('C:\\test\\mind');

    expect(vi.mocked(fs.writeFileSync)).not.toHaveBeenCalled();
  });

  it('preserves unmanaged non-Lens skills', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync)
      .mockReturnValueOnce('new bundled content')
      .mockReturnValueOnce('custom unrelated skill');

    installLensSkill('C:\\test\\mind');

    expect(vi.mocked(fs.writeFileSync)).not.toHaveBeenCalled();
  });
});
