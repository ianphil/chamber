import { createHash } from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
  readdirSync: vi.fn((p: string) => readFakeDir(p)),
  mkdirSync: vi.fn((p: string) => {
    dirs.add(normalizedPath(p));
  }),
  rmSync: vi.fn((p: string, options?: { recursive?: boolean }) => {
    const normalized = normalizedPath(p);
    if (options?.recursive) {
      for (const filePath of [...files.keys()]) {
        if (filePath === normalized || filePath.startsWith(`${normalized}/`)) {
          files.delete(filePath);
        }
      }
      for (const dirPath of [...dirs.keys()]) {
        if (dirPath === normalized || dirPath.startsWith(`${normalized}/`)) {
          dirs.delete(dirPath);
        }
      }
      return;
    }
    files.delete(normalized);
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
    expect(metadataFor('automation').version).toBe('2.2.0');
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
    addFile('C:/packed/resources/managed-skills/lens/SKILL.md', lensSkill('# Packaged Lens'));

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

  it('clobbers locally edited managed Lens skills', () => {
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

    expect(fileText(mindSkillPath('lens', 'SKILL.md'))).toBe(lensSkill('new bundled content'));
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

  const workflowRoot = assetRoot('workflow');

  it('installs a multi-file skill tree with managed metadata', () => {
    addSkillAsset('workflow', 'SKILL.md', skill('workflow', '1.0.0', '# Workflow'));
    addSkillAsset('workflow', 'reference/api.md', '# API');

    installManagedSkill(MIND_PATH, workflowRoot);

    expect(fileText(mindSkillPath('workflow', 'SKILL.md'))).toBe(skill('workflow', '1.0.0', '# Workflow'));
    expect(fileText(mindSkillPath('workflow', 'reference/api.md'))).toBe('# API');
    expect(metadataFor('workflow')).toMatchObject({
      name: 'workflow',
      version: '1.0.0',
      files: [
        { path: 'SKILL.md', sha256: managedSha256('SKILL.md', skill('workflow', '1.0.0', '# Workflow')) },
        { path: 'reference/api.md', sha256: managedSha256('reference/api.md', '# API') },
      ],
    });
  });

  it('skips install when SKILL.md frontmatter does not declare a version', () => {
    addSkillAsset('workflow', 'SKILL.md', '---\nname: workflow\n---\n# Workflow');

    installManagedSkill(MIND_PATH, workflowRoot);

    expect(files.has(normalizedPath(mindSkillPath('workflow', 'SKILL.md')))).toBe(false);
    expect(files.has(normalizedPath(mindSkillPath('workflow', '.chamber-skill.json')))).toBe(false);
  });

  it('upgrades an unmodified managed skill and removes files dropped from the manifest', () => {
    addSkillAsset('workflow', 'SKILL.md', skill('workflow', '2.0.0', '# Workflow v2'));
    addManagedSkillInstall('workflow', '1.0.0', [
      { path: 'SKILL.md', content: '# Workflow v1' },
      { path: 'reference/api.md', content: '# Old API' },
    ]);

    installManagedSkill(MIND_PATH, workflowRoot);

    expect(fileText(mindSkillPath('workflow', 'SKILL.md'))).toBe(skill('workflow', '2.0.0', '# Workflow v2'));
    expect(files.has(normalizedPath(mindSkillPath('workflow', 'reference/api.md')))).toBe(false);
  });

  it('clobbers a managed skill when any installed file has local edits', () => {
    addSkillAsset('workflow', 'SKILL.md', skill('workflow', '1.0.0', '# Workflow v2'));
    addSkillAsset('workflow', 'reference/api.md', '# API v2');
    addManagedSkillInstall('workflow', '1.0.0', [
      { path: 'SKILL.md', content: '# Workflow v1' },
      { path: 'reference/api.md', content: '# API v1' },
    ]);
    addFile(mindSkillPath('workflow', 'reference/api.md'), '# Locally edited API');

    installManagedSkill(MIND_PATH, workflowRoot);

    expect(fileText(mindSkillPath('workflow', 'SKILL.md'))).toBe(skill('workflow', '1.0.0', '# Workflow v2'));
    expect(fileText(mindSkillPath('workflow', 'reference/api.md'))).toBe('# API v2');
  });

  it('repairs a managed skill when a metadata file is missing', () => {
    addSkillAsset('workflow', 'SKILL.md', skill('workflow', '1.0.0', '# Workflow'));
    addSkillAsset('workflow', 'reference/api.md', '# API');
    addManagedSkillInstall('workflow', '1.0.0', [
      { path: 'SKILL.md', content: skill('workflow', '1.0.0', '# Workflow') },
      { path: 'reference/api.md', content: '# API' },
    ]);
    files.delete(normalizedPath(mindSkillPath('workflow', 'reference/api.md')));

    installManagedSkill(MIND_PATH, workflowRoot);

    expect(fileText(mindSkillPath('workflow', 'reference/api.md'))).toBe('# API');
  });

  it('preserves an existing skill when managed metadata contains unsafe paths', () => {
    addSkillAsset('workflow', 'SKILL.md', skill('workflow', '2.0.0', '# Workflow v2'));
    addSkillAsset('workflow', 'reference/api.md', '# API v2');
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

    installManagedSkill(MIND_PATH, workflowRoot);

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
  addSkillAsset('lens', 'SKILL.md', lensSkill(markdown));
}

function addTtasksAssets(): void {
  addSkillAsset('ttasks', 'SKILL.md', skill('ttasks', '0.3.0', '# ttasks'));
  addSkillAsset('ttasks', 'reference/api.md', '# Task API');
  addSkillAsset('ttasks', 'reference/state-machine.md', '# State Machine');
  addSkillAsset('ttasks', 'patterns/agent-tasks.md', '# Agent Tasks');
  addSkillAsset('ttasks', 'patterns/custom-types.md', '# Custom Types');
  addSkillAsset('ttasks', 'patterns/workflow-shapes.md', '# Workflow Shapes');
}

function addAutomationAsset(markdown: string): void {
  addSkillAsset('automation', 'SKILL.md', skill('automation', '2.2.0', markdown));
  addSkillAsset('automation', 'examples/briefing-with-canvas.ts', '// EXAMPLE — Briefing with a Canvas finale.\n');
}

function addSkillAsset(skillName: string, relativePath: string, content: string): void {
  addFile(`${assetRoot(skillName)}/${relativePath}`, content);
}

function assetRoot(skillName: string): string {
  return `${process.cwd()}/apps/desktop/src/main/assets/managed-skills/${skillName}`;
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

function skill(name: string, version: string, markdown: string): string {
  return `---\nname: ${name}\nversion: ${version}\n---\n${markdown}`;
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

function readFakeDir(dirPath: string): Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }> {
  const normalized = normalizedPath(dirPath);
  const prefix = `${normalized}/`;
  const entries = new Map<string, 'file' | 'directory'>();

  for (const filePath of files.keys()) {
    if (!filePath.startsWith(prefix)) continue;
    const remainder = filePath.slice(prefix.length);
    if (!remainder) continue;
    const [name, ...rest] = remainder.split('/');
    entries.set(name, rest.length === 0 ? 'file' : 'directory');
  }

  for (const dir of dirs.keys()) {
    if (!dir.startsWith(prefix)) continue;
    const remainder = dir.slice(prefix.length);
    if (!remainder) continue;
    const [name] = remainder.split('/');
    if (!entries.has(name)) entries.set(name, 'directory');
  }

  if (entries.size === 0) {
    const error = new Error(`ENOENT: no such file or directory, scandir '${dirPath}'`) as NodeJS.ErrnoException;
    error.code = 'ENOENT';
    throw error;
  }

  return [...entries.entries()].map(([name, kind]) => ({
    name,
    isDirectory: () => kind === 'directory',
    isFile: () => kind === 'file',
  }));
}
