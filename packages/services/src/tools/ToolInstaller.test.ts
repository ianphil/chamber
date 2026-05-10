import { describe, it, expect, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { MarketplaceToolEntry } from '@chamber/shared/types';
import { ToolInstaller, type CommandRunner, type CommandResult, type ReleaseAssetDownloader } from './ToolInstaller';

class FakeRunner implements CommandRunner {
  calls: Array<{ command: string; args: string[] }> = [];
  responses: CommandResult[] = [];
  fallback: CommandResult = { exitCode: 0, stdout: '', stderr: '' };
  async run(command: string, args: string[]): Promise<CommandResult> {
    this.calls.push({ command, args });
    return this.responses.shift() ?? this.fallback;
  }
}

class FakeReleaseAssetDownloader implements ReleaseAssetDownloader {
  calls: Array<{ owner: string; repo: string; tag: string; assetName: string }> = [];
  bytes = Buffer.from('fake binary');

  async downloadAsset(request: { owner: string; repo: string; tag: string; assetName: string }): Promise<{ assetName: string; bytes: Buffer }> {
    this.calls.push(request);
    return { assetName: request.assetName, bytes: this.bytes };
  }
}

const TOOL: MarketplaceToolEntry = {
  id: 'workiq',
  displayName: 'Microsoft Work IQ',
  description: 'Query M365 data.',
  install: { type: 'npm-global', package: '@microsoft/workiq', version: 'latest' },
  bin: 'workiq',
  help: 'workiq ask --help',
  preflight: ['workiq accept-eula'],
  agentInstructions: 'Use workiq ask.',
  source: {
    owner: 'ianphil',
    repo: 'genesis-minds',
    ref: 'master',
    plugin: 'genesis-minds',
    marketplaceId: 'github:ianphil/genesis-minds',
    marketplaceLabel: 'Public Genesis Minds',
    marketplaceUrl: 'https://github.com/ianphil/genesis-minds',
  },
};

describe('ToolInstaller', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-tool-installer-'));
    tempDirs.push(dir);
    return dir;
  }

  it('runs npm install -g, the verify command, and any preflight commands', async () => {
    const runner = new FakeRunner();
    const installer = new ToolInstaller(runner);
    const result = await installer.install(TOOL);

    expect(runner.calls[0]).toEqual({ command: 'npm', args: ['install', '-g', '@microsoft/workiq@latest'] });
    expect(runner.calls[1]).toEqual({ command: 'workiq', args: ['--version'] });
    expect(runner.calls[2]).toEqual({ command: 'workiq', args: ['accept-eula'] });
    expect(result.id).toBe('workiq');
    expect(result.install).toEqual({ type: 'npm-global', package: '@microsoft/workiq', version: 'latest' });
    expect(result.bin).toBe('workiq');
    expect(result.displayName).toBe('Microsoft Work IQ');
    expect(result.agentInstructions).toBe('Use workiq ask.');
    expect(result.source).toEqual({ marketplaceId: 'github:ianphil/genesis-minds', pluginId: 'genesis-minds' });
  });

  it('throws with stderr when npm install -g exits non-zero', async () => {
    const runner = new FakeRunner();
    runner.responses = [{ exitCode: 1, stdout: '', stderr: 'EACCES denied' }];
    const installer = new ToolInstaller(runner);

    await expect(installer.install(TOOL)).rejects.toThrow(/EACCES denied/);
  });

  it('continues installing even if --version verification fails', async () => {
    const runner = new FakeRunner();
    runner.responses = [
      { exitCode: 0, stdout: '', stderr: '' },
      { exitCode: 127, stdout: '', stderr: 'workiq: not found' },
      { exitCode: 0, stdout: '', stderr: '' },
    ];
    const installer = new ToolInstaller(runner);
    const result = await installer.install(TOOL);
    expect(result.bin).toBe('workiq');
  });

  it('uninstalls via npm uninstall -g and surfaces errors', async () => {
    const runner = new FakeRunner();
    const installer = new ToolInstaller(runner);
    await installer.uninstall({
      id: 'workiq',
      package: '@microsoft/workiq',
      version: 'latest',
      bin: 'workiq',
      displayName: 'Microsoft Work IQ',
      description: 'Query M365 data.',
      source: { marketplaceId: 'm', pluginId: 'p' },
      installedAt: '2026-01-01T00:00:00Z',
    });
    expect(runner.calls[0]).toEqual({ command: 'npm', args: ['uninstall', '-g', '@microsoft/workiq'] });
  });

  it('downloads a GitHub release asset, verifies its checksum, and installs it into the tools bin directory', async () => {
    const runner = new FakeRunner();
    const downloader = new FakeReleaseAssetDownloader();
    const toolsBinDir = makeTempDir();
    const sha256 = createHash('sha256').update(downloader.bytes).digest('hex');
    const installer = new ToolInstaller(runner, downloader, toolsBinDir);

    const result = await installer.install({
      ...TOOL,
      id: 'a365-teams',
      displayName: 'A365 Teams CLI',
      description: 'Read and post Teams messages.',
      install: {
        type: 'github-release-asset',
        owner: 'agency-microsoft',
        repo: 'a365-cli',
        tag: 'v0.5.0',
        assets: [{ platform: process.platform, arch: process.arch, name: 'teams.exe', sha256 }],
      },
      bin: 'teams',
      help: 'teams --help',
      preflight: undefined,
      agentInstructions: 'Use teams read.',
    });

    expect(downloader.calls).toEqual([{
      owner: 'agency-microsoft',
      repo: 'a365-cli',
      tag: 'v0.5.0',
      assetName: 'teams.exe',
    }]);
    expect(result.install?.type).toBe('github-release-asset');
    if (result.install?.type !== 'github-release-asset') {
      throw new Error('Expected a GitHub release asset install record');
    }
    expect(fs.readFileSync(result.install.installedPath)).toEqual(downloader.bytes);
    expect(result.install.assetName).toBe('teams.exe');
    expect(result.install.sha256).toBe(sha256);
    expect(result.bin).toBe('teams');
    expect(runner.calls.map((call) => call.command)).not.toEqual(expect.arrayContaining(['gh', 'go']));
  });

  it('refuses to install a GitHub release asset with a checksum mismatch', async () => {
    const downloader = new FakeReleaseAssetDownloader();
    const installer = new ToolInstaller(new FakeRunner(), downloader, makeTempDir());

    await expect(installer.install({
      ...TOOL,
      id: 'a365-teams',
      install: {
        type: 'github-release-asset',
        owner: 'agency-microsoft',
        repo: 'a365-cli',
        tag: 'v0.5.0',
        assets: [{ platform: process.platform, arch: process.arch, name: 'teams.exe', sha256: '0'.repeat(64) }],
      },
      bin: 'teams',
    })).rejects.toThrow('checksum mismatch');
  });

  it('refuses to install a GitHub release asset outside the tools bin directory', async () => {
    const downloader = new FakeReleaseAssetDownloader();
    const sha256 = createHash('sha256').update(downloader.bytes).digest('hex');
    const installer = new ToolInstaller(new FakeRunner(), downloader, makeTempDir());

    await expect(installer.install({
      ...TOOL,
      id: 'a365-teams',
      install: {
        type: 'github-release-asset',
        owner: 'agency-microsoft',
        repo: 'a365-cli',
        tag: 'v0.5.0',
        assets: [{ platform: process.platform, arch: process.arch, name: 'teams.exe', sha256 }],
      },
      bin: '..\\Startup\\evil',
    })).rejects.toThrow('outside the tools bin directory');
  });

  it('cleans up the temporary release asset when replacement fails', async () => {
    const downloader = new FakeReleaseAssetDownloader();
    const toolsBinDir = makeTempDir();
    const sha256 = createHash('sha256').update(downloader.bytes).digest('hex');
    const installer = new ToolInstaller(new FakeRunner(), downloader, toolsBinDir);
    const rename = vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      const error = new Error('locked') as NodeJS.ErrnoException;
      error.code = 'EPERM';
      throw error;
    });

    try {
      await expect(installer.install({
        ...TOOL,
        id: 'a365-teams',
        install: {
          type: 'github-release-asset',
          owner: 'agency-microsoft',
          repo: 'a365-cli',
          tag: 'v0.5.0',
          assets: [{ platform: process.platform, arch: process.arch, name: 'teams.exe', sha256 }],
        },
        bin: 'teams',
      })).rejects.toThrow('locked');
      expect(fs.readdirSync(toolsBinDir).filter((file) => file.includes('.tmp-'))).toEqual([]);
    } finally {
      rename.mockRestore();
    }
  });

  it('uninstalls a GitHub release asset by deleting its installed binary', async () => {
    const toolsBinDir = makeTempDir();
    const installedPath = path.join(toolsBinDir, 'teams.exe');
    fs.writeFileSync(installedPath, 'binary');
    const runner = new FakeRunner();
    const installer = new ToolInstaller(runner, new FakeReleaseAssetDownloader(), toolsBinDir);

    await installer.uninstall({
      id: 'a365-teams',
      version: 'v0.5.0',
      bin: 'teams',
      displayName: 'A365 Teams CLI',
      description: 'Read and post Teams messages.',
      source: { marketplaceId: 'm', pluginId: 'p' },
      installedAt: '2026-01-01T00:00:00Z',
      install: {
        type: 'github-release-asset',
        owner: 'agency-microsoft',
        repo: 'a365-cli',
        tag: 'v0.5.0',
        assetName: 'teams.exe',
        sha256: '1'.repeat(64),
        platform: 'win32',
        arch: 'x64',
        installedPath,
      },
    });

    expect(fs.existsSync(installedPath)).toBe(false);
    expect(runner.calls).toEqual([]);
  });
});
