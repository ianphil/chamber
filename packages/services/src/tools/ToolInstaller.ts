import { spawn } from 'node:child_process';
import type { InstalledTool, MarketplaceToolEntry } from '@chamber/shared/types';
import { Logger } from '../logger';

const log = Logger.create('ToolInstaller');

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface CommandRunner {
  run(command: string, args: string[]): Promise<CommandResult>;
}

export class ToolInstaller {
  constructor(private readonly runner: CommandRunner = new ChildProcessRunner()) {}

  async install(tool: MarketplaceToolEntry): Promise<InstalledTool> {
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
      bin: tool.bin,
      displayName: tool.displayName,
      description: tool.description,
      ...(tool.help ? { help: tool.help } : {}),
      ...(tool.agentInstructions ? { agentInstructions: tool.agentInstructions } : {}),
      source: { marketplaceId: tool.source.marketplaceId, pluginId: tool.source.plugin },
      installedAt: new Date().toISOString(),
    };
  }

  async uninstall(tool: InstalledTool): Promise<void> {
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
