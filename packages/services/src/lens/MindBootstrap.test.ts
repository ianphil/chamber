import { createHash } from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ManagedSkillManifest } from './MindBootstrap';

const files = new Map<string, Buffer>();
const dirs = new Set<string>();

vi.mock('fs', () => ({
  existsSync: vi.fn((p: string) => files.has(normalizedPath(p)) || dirs.has(normalizedPath(p))),
  readFileSync: vi.fn((p: string, encoding?: BufferEncoding) => {
    const content = files.get(normalizedPath(p));
    if (!content) {
      const error = new Error(`ENOENT: no such file or directory, open '${String(p)}'`) as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      throw error;
    }
    return encoding ? content.toString(encoding) : Buffer.from(content);
  }),
  writeFileSync: vi.fn((p: string, data: string | Buffer) => {
    files.set(normalizedPath(p), Buffer.isBuffer(data) ? Buffer.from(data) : Buffer.from(data));
  }),
  mkdirSync: vi.fn((p: string) => {
    dirs.add(normalizedPath(p));
  }),
  rmSync: vi.fn((p: string) => {
    files.delete(normalizedPath(p));
  }),
}));

import * as fs from 'fs';
import {
  bootstrapMindCapabilities,
  installLensSkill,
  installManagedSkill,
  seedLensDefaults,
} from './MindBootstrap';

const MIND_PATH = 'C:\\test\\mind';

describe('seedLensDefaults', () => {
  beforeEach(resetFakeFs);

  it('creates views when missing', () => {
    seedLensDefaults(MIND_PATH);

    expect(fileText(mindLensPath('hello-world/view.json'))).toContain('"Hello World"');
    expect(fileText(mindLensPath('newspaper/view.json'))).toContain('"Newspaper"');
  });

  it('skips when views exist', () => {
    addFile(mindLensPath('hello-world/view.json'), '{}');
    addFile(mindLensPath('newspaper/view.json'), '{}');

    seedLensDefaults(MIND_PATH);

    expect(vi.mocked(fs.writeFileSync)).not.toHaveBeenCalled();
  });
});

describe('bootstrapMindCapabilities', () => {
  beforeEach(resetFakeFs);

  it('seeds default lenses and installs Lens, ttasks, and automation skills', () => {
    addAllManagedSkillAssets();

    bootstrapMindCapabilities(MIND_PATH);

    expect(fileText(mindLensPath('hello-world/view.json'))).toContain('"Hello World"');
    expect(fileText(mindSkillPath('lens', 'SKILL.md'))).toContain('# Lens');
    expect(fileText(mindSkillPath('ttasks', 'reference/api.md'))).toContain('Task API');
    expect(fileText(mindSkillPath('automation', 'SKILL.md'))).toContain('# Automation');
    expect(fileText(mindSkillPath('automation', 'examples/briefing-with-canvas.ts'))).toContain('Canvas finale');
  });

  it('continues installing available skills when one asset tree is missing', () => {
    addLensAsset('# Lens');
    addAutomationAsset('# Automation');

    expect(() => bootstrapMindCapabilities(MIND_PATH)).not.toThrow();

    expect(fileText(mindSkillPath('lens', 'SKILL.md'))).toContain('# Lens');
    expect(fileText(mindSkillPath('automation', 'SKILL.md'))).toContain('# Automation');
    expect(files.has(normalizedPath(mindSkillPath('ttasks', 'SKILL.md')))).toBe(false);
  });

  it('adds missing new skills to an existing mind without disturbing managed Lens', () => {
    const lensContent = lensSkill('# Existing Lens');
    addLensAsset('# Existing Lens');
    addTtasksAssets();
    addAutomationAsset('# Automation');
    addManagedSkillInstall('lens', '2.0.0', [{ path: 'SKILL.md', content: lensContent }]);

    bootstrapMindCapabilities(MIND_PATH);

    expect(fileText(mindSkillPath('lens', 'SKILL.md'))).toBe(lensContent);
    expect(fileText(mindSkillPath('ttasks', 'SKILL.md'))).toContain('# ttasks');
    expect(fileText(mindSkillPath('automation', 'SKILL.md'))).toContain('# Automation');
  });
});

describe('installLensSkill', () => {
  beforeEach(resetFakeFs);
  afterEach(restoreResourcesPath);

  it('installs the bundled Lens skill with managed metadata when missing', () => {
    addLensAsset('# Lens');

    installLensSkill(MIND_PATH);

    expect(fileText(mindSkillPath('lens', 'SKILL.md'))).toContain('# Lens');
    expect(metadataFor('lens')).toMatchObject({
      name: 'lens',
      version: '2.0.0',
      managedBy: 'chamber',
      algorithm: 'sha256-framed-v2',
      capabilities: ['lens-json', 'canvas-lens', 'chamber-theme-v1'],
    });
    expect(metadataFor('lens').files).toEqual([{ path: 'SKILL.md', sha256: managedSha256('SKILL.md', lensSkill('# Lens')) }]);
  });

  it('installs the Lens skill from packaged Forge resources', () => {
    setResourcesPath('C:\\packed\\resources');
    addFile('C:/packed/resources/lens-skill/SKILL.md', lensSkill('# Packaged Lens'));

    installLensSkill(MIND_PATH);

    expect(fileText(mindSkillPath('lens', 'SKILL.md'))).toContain('# Packaged Lens');
  });

  it('upgrades a managed unmodified Lens skill from legacy metadata', () => {
    const oldContent = 'old managed content';
    addLensAsset('new bundled content');
    addFile(mindSkillPath('lens', 'SKILL.md'), oldContent);
    addFile(mindSkillPath('lens', '.chamber-skill.json'), JSON.stringify({
      name: 'lens',
      version: '1.0.0',
      managedBy: 'chamber',
      contentSha256: sha256(oldContent),
      capabilities: ['lens-json'],
    }));

    installLensSkill(MIND_PATH);

    expect(fileText(mindSkillPath('lens', 'SKILL.md'))).toBe(lensSkill('new bundled content'));
    expect(metadataFor('lens').algorithm).toBe('sha256-framed-v2');
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
    addLensAsset('new bundled content');
    addFile(mindSkillPath('lens', 'SKILL.md'), legacySkill);

    installLensSkill(MIND_PATH);

    expect(fileText(mindSkillPath('lens', 'SKILL.legacy-backup.md'))).toBe(legacySkill);
    expect(fileText(mindSkillPath('lens', 'SKILL.md'))).toBe(lensSkill('new bundled content'));
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
    addLensAsset('new bundled content');
    addFile(mindSkillPath('lens', 'SKILL.md'), legacySkill);

    installLensSkill(MIND_PATH);

    expect(fileText(mindSkillPath('lens', 'SKILL.md'))).toBe(lensSkill('new bundled content'));
  });

  it('preserves locally edited managed Lens skills', () => {
    addLensAsset('new bundled content');
    addFile(mindSkillPath('lens', 'SKILL.md'), 'locally edited content');
    addFile(mindSkillPath('lens', '.chamber-skill.json'), JSON.stringify({
      name: 'lens',
      version: '1.0.0',
      managedBy: 'chamber',
      contentSha256: 'different',
      capabilities: ['lens-json'],
    }));

    installLensSkill(MIND_PATH);

    expect(fileText(mindSkillPath('lens', 'SKILL.md'))).toBe('locally edited content');
  });

  it('preserves unmanaged non-Lens skills', () => {
    addLensAsset('new bundled content');
    addFile(mindSkillPath('lens', 'SKILL.md'), 'custom unrelated skill');

    installLensSkill(MIND_PATH);

    expect(fileText(mindSkillPath('lens', 'SKILL.md'))).toBe('custom unrelated skill');
  });
});

describe('installManagedSkill', () => {
  beforeEach(resetFakeFs);

  const manifest: ManagedSkillManifest = {
    name: 'workflow',
    version: '1.0.0',
    assetRoot: 'workflow-skill',
    files: ['SKILL.md', 'reference/api.md'],
    capabilities: ['workflow'],
  };

  it('installs a multi-file skill tree with managed metadata', () => {
    addAsset('workflow-skill', 'SKILL.md', '# Workflow');
    addAsset('workflow-skill', 'reference/api.md', '# API');

    installManagedSkill(MIND_PATH, manifest);

    expect(fileText(mindSkillPath('workflow', 'SKILL.md'))).toBe('# Workflow');
    expect(fileText(mindSkillPath('workflow', 'reference/api.md'))).toBe('# API');
    expect(metadataFor('workflow')).toMatchObject({
      name: 'workflow',
      version: '1.0.0',
      files: [
        { path: 'SKILL.md', sha256: managedSha256('SKILL.md', '# Workflow') },
        { path: 'reference/api.md', sha256: managedSha256('reference/api.md', '# API') },
      ],
    });
  });

  it('skips install when a nested file is missing under the resolved asset root', () => {
    addAsset('workflow-skill', 'SKILL.md', '# Workflow');

    installManagedSkill(MIND_PATH, manifest);

    expect(files.has(normalizedPath(mindSkillPath('workflow', 'SKILL.md')))).toBe(false);
    expect(files.has(normalizedPath(mindSkillPath('workflow', '.chamber-skill.json')))).toBe(false);
  });

  it('upgrades an unmodified managed skill and removes files dropped from the manifest', () => {
    const nextManifest = { ...manifest, version: '2.0.0', files: ['SKILL.md'] };
    addAsset('workflow-skill', 'SKILL.md', '# Workflow v2');
    addManagedSkillInstall('workflow', '1.0.0', [
      { path: 'SKILL.md', content: '# Workflow v1' },
      { path: 'reference/api.md', content: '# Old API' },
    ]);

    installManagedSkill(MIND_PATH, nextManifest);

    expect(fileText(mindSkillPath('workflow', 'SKILL.md'))).toBe('# Workflow v2');
    expect(files.has(normalizedPath(mindSkillPath('workflow', 'reference/api.md')))).toBe(false);
  });

  it('preserves a managed skill when any installed file has local edits', () => {
    addAsset('workflow-skill', 'SKILL.md', '# Workflow v2');
    addAsset('workflow-skill', 'reference/api.md', '# API v2');
    addManagedSkillInstall('workflow', '1.0.0', [
      { path: 'SKILL.md', content: '# Workflow v1' },
      { path: 'reference/api.md', content: '# API v1' },
    ]);
    addFile(mindSkillPath('workflow', 'reference/api.md'), '# Locally edited API');

    installManagedSkill(MIND_PATH, manifest);

    expect(fileText(mindSkillPath('workflow', 'SKILL.md'))).toBe('# Workflow v1');
    expect(fileText(mindSkillPath('workflow', 'reference/api.md'))).toBe('# Locally edited API');
  });

  it('repairs a managed skill when a metadata file is missing', () => {
    addAsset('workflow-skill', 'SKILL.md', '# Workflow');
    addAsset('workflow-skill', 'reference/api.md', '# API');
    addManagedSkillInstall('workflow', '1.0.0', [
      { path: 'SKILL.md', content: '# Workflow' },
      { path: 'reference/api.md', content: '# API' },
    ]);
    files.delete(normalizedPath(mindSkillPath('workflow', 'reference/api.md')));

    installManagedSkill(MIND_PATH, manifest);

    expect(fileText(mindSkillPath('workflow', 'reference/api.md'))).toBe('# API');
  });

  it('preserves an existing skill when managed metadata contains unsafe paths', () => {
    addAsset('workflow-skill', 'SKILL.md', '# Workflow v2');
    addAsset('workflow-skill', 'reference/api.md', '# API v2');
    addFile(mindSkillPath('workflow', 'SKILL.md'), '# Workflow v1');
    addFile(`${MIND_PATH}/.github/skills/outside.txt`, 'outside content');
    addFile(mindSkillPath('workflow', '.chamber-skill.json'), JSON.stringify({
      name: 'workflow',
      version: '1.0.0',
      managedBy: 'chamber',
      algorithm: 'sha256-framed-v2',
      files: [
        { path: 'SKILL.md', sha256: managedSha256('SKILL.md', '# Workflow v1') },
        { path: '../outside.txt', sha256: managedSha256('../outside.txt', 'outside content') },
      ],
      capabilities: ['test'],
    }));

    installManagedSkill(MIND_PATH, manifest);

    expect(fileText(mindSkillPath('workflow', 'SKILL.md'))).toBe('# Workflow v1');
    expect(fileText(`${MIND_PATH}/.github/skills/outside.txt`)).toBe('outside content');
  });
});

function resetFakeFs(): void {
  files.clear();
  dirs.clear();
  vi.clearAllMocks();
  restoreResourcesPath();
}

const originalResourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;

function setResourcesPath(value: string): void {
  Object.defineProperty(process, 'resourcesPath', {
    configurable: true,
    value,
  });
}

function restoreResourcesPath(): void {
  Object.defineProperty(process, 'resourcesPath', {
    configurable: true,
    value: originalResourcesPath,
  });
}

function addAllManagedSkillAssets(): void {
  addLensAsset('# Lens');
  addTtasksAssets();
  addAutomationAsset('# Automation');
}

function addLensAsset(markdown: string): void {
  addAsset('lens-skill', 'SKILL.md', lensSkill(markdown));
}

function addTtasksAssets(): void {
  addAsset('ttasks-skill', 'SKILL.md', '---\nname: ttasks\n---\n# ttasks');
  addAsset('ttasks-skill', 'reference/api.md', '# Task API');
  addAsset('ttasks-skill', 'reference/state-machine.md', '# State Machine');
  addAsset('ttasks-skill', 'patterns/agent-tasks.md', '# Agent Tasks');
  addAsset('ttasks-skill', 'patterns/custom-types.md', '# Custom Types');
  addAsset('ttasks-skill', 'patterns/workflow-shapes.md', '# Workflow Shapes');
}

function addAutomationAsset(markdown: string): void {
  addAsset('automation-skill', 'SKILL.md', `---\nname: automation\n---\n${markdown}`);
  addAsset('automation-skill', 'examples/briefing-with-canvas.ts', '// EXAMPLE — Briefing with a Canvas finale.\n');
}

function addAsset(assetRoot: string, relativePath: string, content: string): void {
  addFile(`${process.cwd()}/apps/desktop/src/main/assets/${assetRoot}/${relativePath}`, content);
}

function addManagedSkillInstall(
  name: string,
  version: string,
  installedFiles: Array<{ path: string; content: string }>,
): void {
  for (const file of installedFiles) {
    addFile(mindSkillPath(name, file.path), file.content);
  }
  addFile(mindSkillPath(name, '.chamber-skill.json'), JSON.stringify({
    name,
    version,
    managedBy: 'chamber',
    algorithm: 'sha256-framed-v2',
    files: installedFiles.map((file) => ({ path: file.path, sha256: managedSha256(file.path, file.content) })),
    capabilities: ['test'],
  }));
}

function lensSkill(markdown: string): string {
  return `---\nname: lens\nversion: 2.0.0\n---\n${markdown}`;
}

function addFile(filePath: string, content: string): void {
  files.set(normalizedPath(filePath), Buffer.from(content));
}

function fileText(filePath: string): string {
  const content = files.get(normalizedPath(filePath));
  if (!content) throw new Error(`Missing fake file: ${filePath}`);
  return content.toString('utf-8');
}

interface TestMetadata {
  name: string;
  version: string;
  managedBy: string;
  algorithm: string;
  files: Array<{ path: string; sha256: string }>;
  capabilities: string[];
}

function metadataFor(skillName: string): TestMetadata {
  return JSON.parse(fileText(mindSkillPath(skillName, '.chamber-skill.json'))) as TestMetadata;
}

function mindLensPath(relativePath: string): string {
  return `${MIND_PATH}/.github/lens/${relativePath}`;
}

function mindSkillPath(skillName: string, relativePath: string): string {
  return `${MIND_PATH}/.github/skills/${skillName}/${relativePath}`;
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function managedSha256(filePath: string, content: string): string {
  return createHash('sha256')
    .update(filePath)
    .update('\0')
    .update(String(Buffer.byteLength(content)))
    .update('\0')
    .update(content)
    .update('\0')
    .digest('hex');
}

function normalizedPath(value: unknown): string {
  return String(value).replace(/\\/g, '/');
}
