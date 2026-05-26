import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { InstalledTool, MarketplaceToolEntry } from '@chamber/shared/types';
import { Logger } from '../logger';
import { GitHubReleaseAssetClient, type DownloadReleaseAssetRequest, type DownloadedReleaseAsset } from './GitHubReleaseAssetClient';
import { getChamberToolsBinDir } from './toolPaths';

const log = Logger.create('ToolInstaller');

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface CommandRunner {
  run(command: string, args: string[]): Promise<CommandResult>;
}

export interface ReleaseAssetDownloader {
  downloadAsset(request: DownloadReleaseAssetRequest): Promise<DownloadedReleaseAsset>;
}

export class ToolInstaller {
  constructor(
    private readonly runner: CommandRunner = new ChildProcessRunner(),
    private readonly releaseAssetDownloader: ReleaseAssetDownloader = new GitHubReleaseAssetClient(),
    private readonly toolsBinDir: string = getChamberToolsBinDir(),
  ) {}

  async install(tool: MarketplaceToolEntry): Promise<InstalledTool> {
    if (tool.install.type === 'github-release-asset') {
      return this.installGitHubReleaseAsset(tool);
    }
    return this.installNpmGlobal(tool);
  }

  private async installNpmGlobal(tool: MarketplaceToolEntry): Promise<InstalledTool> {
    if (tool.install.type !== 'npm-global') {
      throw new Error(`Unsupported npm install type: ${tool.install.type}`);
    }
    const spec = `${tool.install.package}@${tool.install.version}`;
    log.info(`Installing tool ${tool.id} (${spec}) globally via npm`);
    const installResult = await this.runner.run('npm', ['install', '-g', spec]);
    if (installResult.exitCode !== 0) {
      throw new Error(
        `npm install -g ${spec} failed (exit ${installResult.exitCode})\n${installResult.stderr || installResult.stdout}`.trim(),
      );
    }

    const verifyResult = await this.runner.run(tool.bin, ['--version']);
    if (verifyResult.exitCode !== 0) {
      log.warn(`Tool ${tool.bin} --version exited ${verifyResult.exitCode}; continuing.`);
    }

    for (const command of tool.preflight ?? []) {
      const [bin, ...args] = command.split(/\s+/).filter(Boolean);
      if (!bin) continue;
      log.info(`Running preflight: ${command}`);
      const preflightResult = await this.runner.run(bin, args);
      if (preflightResult.exitCode !== 0) {
        log.warn(`Preflight "${command}" exited ${preflightResult.exitCode}: ${preflightResult.stderr.trim()}`);
      }
    }

    return {
      id: tool.id,
      package: tool.install.package,
      version: tool.install.version,
      install: { type: 'npm-global', package: tool.install.package, version: tool.install.version },
      bin: tool.bin,
      displayName: tool.displayName,
      description: tool.description,
      ...(tool.help ? { help: tool.help } : {}),
      ...(tool.agentInstructions ? { agentInstructions: tool.agentInstructions } : {}),
      source: { marketplaceId: tool.source.marketplaceId, pluginId: tool.source.plugin },
      installedAt: new Date().toISOString(),
    };
  }

  private async installGitHubReleaseAsset(tool: MarketplaceToolEntry): Promise<InstalledTool> {
    if (tool.install.type !== 'github-release-asset') {
      throw new Error(`Unsupported release asset install type: ${tool.install.type}`);
    }
    const asset = tool.install.assets.find((candidate) =>
      candidate.platform === process.platform && candidate.arch === process.arch,
    );
    if (!asset) {
      throw new Error(`Tool ${tool.id} does not provide a release asset for ${process.platform}/${process.arch}`);
    }

    log.info(`Installing tool ${tool.id} from GitHub release asset ${tool.install.owner}/${tool.install.repo}@${tool.install.tag}/${asset.name}`);
    const downloaded = await this.releaseAssetDownloader.downloadAsset({
      owner: tool.install.owner,
      repo: tool.install.repo,
      tag: tool.install.tag,
      assetName: asset.name,
    });
    const actualSha256 = createHash('sha256').update(downloaded.bytes).digest('hex');
    if (actualSha256 !== asset.sha256) {
      throw new Error(`GitHub release asset checksum mismatch for ${tool.id}: expected ${asset.sha256}, got ${actualSha256}`);
    }

    fs.mkdirSync(this.toolsBinDir, { recursive: true });
    const installedPath = resolveInstallPath(this.toolsBinDir, tool.bin);
    const tempPath = `${installedPath}.tmp-${process.pid}-${Date.now()}`;
    try {
      fs.writeFileSync(tempPath, downloaded.bytes, { mode: 0o755 });
      if (process.platform !== 'win32') {
        fs.chmodSync(tempPath, 0o755);
      }
      await replaceFile(tempPath, installedPath);
    } catch (error) {
      fs.rmSync(tempPath, { force: true });
      throw error;
    }

    return {
      id: tool.id,
      version: tool.install.tag,
      bin: tool.bin,
      displayName: tool.displayName,
      description: tool.description,
      ...(tool.help ? { help: tool.help } : {}),
      ...(tool.agentInstructions ? { agentInstructions: tool.agentInstructions } : {}),
      source: { marketplaceId: tool.source.marketplaceId, pluginId: tool.source.plugin },
      installedAt: new Date().toISOString(),
      install: {
        type: 'github-release-asset',
        owner: tool.install.owner,
        repo: tool.install.repo,
        tag: tool.install.tag,
        assetName: asset.name,
        sha256: asset.sha256,
        platform: asset.platform,
        arch: asset.arch,
        installedPath,
        ...(asset.archive ? { archive: asset.archive } : {}),
        ...(asset.binPath ? { binPath: asset.binPath } : {}),
      },
    };
  }

  async uninstall(tool: InstalledTool): Promise<void> {
    if (tool.install?.type === 'github-release-asset') {
      fs.rmSync(tool.install.installedPath, { force: true });
      return;
    }
    if (!('package' in tool)) {
      throw new Error(`Cannot uninstall npm tool ${tool.id}: package is missing`);
    }
    const result = await this.runner.run('npm', ['uninstall', '-g', tool.package]);
    if (result.exitCode !== 0) {
      throw new Error(
        `npm uninstall -g ${tool.package} failed (exit ${result.exitCode})\n${result.stderr || result.stdout}`.trim(),
      );
    }
  }

}

export class ChildProcessRunner implements CommandRunner {
  async run(command: string, args: string[]): Promise<CommandResult> {
    return new Promise((resolve) => {
      const child = spawn(command, args, { shell: process.platform === 'win32', windowsHide: true });
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
      child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
      child.on('error', (error) => {
        resolve({ exitCode: -1, stdout, stderr: stderr || error.message });
      });
      child.on('close', (code) => {
        resolve({ exitCode: code ?? 0, stdout, stderr });
      });
    });
  }
}

function executableName(bin: string): string {
  return process.platform === 'win32' && !bin.toLowerCase().endsWith('.exe') ? `${bin}.exe` : bin;
}

function resolveInstallPath(toolsBinDir: string, bin: string): string {
  const toolsBinRoot = path.resolve(toolsBinDir);
  const executablePath = executableName(bin);
  if (path.isAbsolute(executablePath) || /^[a-zA-Z]:[\\/]/.test(executablePath)) {
    throw new Error(`Refusing to install tool ${bin} outside the tools bin directory`);
  }
  const segments = executablePath.split(/[\\/]+/).filter(Boolean);
  if (segments.length === 0 || segments.includes('..')) {
    throw new Error(`Refusing to install tool ${bin} outside the tools bin directory`);
  }
  const installedPath = path.resolve(toolsBinRoot, ...segments);
  if (installedPath !== toolsBinRoot && installedPath.startsWith(`${toolsBinRoot}${path.sep}`)) {
    return installedPath;
  }
  throw new Error(`Refusing to install tool ${bin} outside the tools bin directory`);
}

async function replaceFile(tempPath: string, installedPath: string): Promise<void> {
  const retryDelaysMs = process.platform === 'win32' ? [100, 250, 500, 1_000, 2_000] : [];
  for (let attempt = 0; ; attempt += 1) {
    try {
      fs.renameSync(tempPath, installedPath);
      return;
    } catch (error) {
      if (!isRetryableReplaceError(error) || attempt >= retryDelaysMs.length) {
        throw error;
      }
      await delay(retryDelaysMs[attempt]);
    }
  }
}

function isRetryableReplaceError(error: unknown): boolean {
  if (process.platform !== 'win32') return false;
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'EPERM' || code === 'EBUSY';
}
