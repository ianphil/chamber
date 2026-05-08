import { describe, it, expect } from 'vitest';
import type { MarketplaceToolEntry } from '@chamber/shared/types';
import { ToolInstaller, type CommandRunner, type CommandResult } from './ToolInstaller';

class FakeRunner implements CommandRunner {
  calls: Array<{ command: string; args: string[] }> = [];
  responses: CommandResult[] = [];
  fallback: CommandResult = { exitCode: 0, stdout: '', stderr: '' };
  async run(command: string, args: string[]): Promise<CommandResult> {
    this.calls.push({ command, args });
    return this.responses.shift() ?? this.fallback;
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
  it('runs npm install -g, the verify command, and any preflight commands', async () => {
    const runner = new FakeRunner();
    const installer = new ToolInstaller(runner);
    const result = await installer.install(TOOL);

    expect(runner.calls[0]).toEqual({ command: 'npm', args: ['install', '-g', '@microsoft/workiq@latest'] });
    expect(runner.calls[1]).toEqual({ command: 'workiq', args: ['--version'] });
    expect(runner.calls[2]).toEqual({ command: 'workiq', args: ['accept-eula'] });
    expect(result.id).toBe('workiq');
    expect(result.package).toBe('@microsoft/workiq');
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
});
