import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
}));

import * as fs from 'fs';
import { IdentityLoader } from './IdentityLoader';
import type { InstalledTool } from '@chamber/shared/types';

describe('IdentityLoader', () => {
  const loader = new IdentityLoader();
  beforeEach(() => vi.clearAllMocks());

  describe('load', () => {
    it('returns null when mindPath is null', () => {
      expect(loader.load(null)).toBeNull();
    });

    it('returns MindIdentity with name and systemMessage', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('# Q\nI am an agent.');
      vi.mocked(fs.readdirSync).mockReturnValue([]);
      const result = loader.load('/tmp/test');
      expect(result).toEqual({
        name: 'Q',
        systemMessage: expect.stringContaining('# Q\nI am an agent.'),
      });
      expect(result?.systemMessage).toContain('## Chamber');
      expect(result?.systemMessage).toContain('operating inside Chamber as a Chamber agent');
      expect(result?.systemMessage).toContain('https://github.com/ianphil/chamber');
    });

    it('extracts name from first H1 heading', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('# My Agent Name\nSome content\n# Another heading');
      vi.mocked(fs.readdirSync).mockReturnValue([]);
      expect(loader.load('/tmp/test')?.name).toBe('My Agent Name');
    });

    it('falls back to folder name when no H1 exists', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('No heading here, just content.');
      vi.mocked(fs.readdirSync).mockReturnValue([]);
      expect(loader.load('/tmp/agents/fox')?.name).toBe('fox');
    });

    it('strips "— Soul" suffix from name', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('# The Dude — Soul\nContent');
      vi.mocked(fs.readdirSync).mockReturnValue([]);
      expect(loader.load('/tmp/agents/dude')?.name).toBe('The Dude');
    });

    it('includes agent file content in systemMessage', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync)
        .mockReturnValueOnce('# Soul')
        .mockReturnValueOnce('---\nname: test\n---\nInstructions');
      (vi.mocked(fs.readdirSync) as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue(['main.agent.md']);
      const result = loader.load('/tmp/test');
      expect(result?.systemMessage).toContain('Instructions');
      expect(result?.systemMessage).not.toContain('name: test');
    });

    it('includes working-memory files in systemMessage', () => {
      vi.mocked(fs.existsSync).mockImplementation((candidate) => {
        const normalized = String(candidate).replace(/\\/g, '/');
        return [
          '/tmp/test/SOUL.md',
          '/tmp/test/.working-memory',
        ].includes(normalized);
      });
      vi.mocked(fs.readFileSync).mockImplementation((candidate) => {
        const normalized = String(candidate).replace(/\\/g, '/');
        if (normalized.endsWith('SOUL.md')) return '# Soul';
        if (normalized.endsWith('memory.md')) return 'Curated memory';
        if (normalized.endsWith('rules.md')) return 'Operational rule';
        if (normalized.endsWith('log.md')) return 'Chronological note';
        return '';
      });
      vi.mocked(fs.readdirSync).mockImplementation((candidate) => {
        const normalized = String(candidate).replace(/\\/g, '/');
        if (normalized.endsWith('/.working-memory')) {
          return ['memory.md', 'rules.md', 'log.md'] as unknown as ReturnType<typeof fs.readdirSync>;
        }
        return [] as unknown as ReturnType<typeof fs.readdirSync>;
      });

      // Use an injected composer so the test does not depend on `node:fs`
      // (the real composer reads via `node:fs`, which the `vi.mock('fs')` setup
      // above does not intercept). The composer contract here is only that
      // IdentityLoader forwards mindPath and inserts the returned section.
      const composer = {
        compose: vi.fn(() => 'Curated memory\n\n---\n\nOperational rule'),
      };
      const customLoader = new IdentityLoader(() => [], composer);
      const result = customLoader.load('/tmp/test');

      expect(composer.compose).toHaveBeenCalledWith('/tmp/test', expect.objectContaining({
        lastKTurns: expect.any(Number),
        perTurnMaxBytes: expect.any(Number),
        memoryMaxBytes: expect.any(Number),
      }));
      expect(result?.systemMessage).toContain('Curated memory');
      expect(result?.systemMessage).toContain('Operational rule');
      // Unstructured log.md is filtered out by the composer; the IdentityLoader
      // never includes it directly. The fake composer above returns no log
      // section, so the chronological note must NOT appear.
      expect(result?.systemMessage).not.toContain('Chronological note');
    });

    it('does not extract the mind name from working-memory headings', () => {
      vi.mocked(fs.existsSync).mockImplementation((candidate) => {
        const normalized = String(candidate).replace(/\\/g, '/');
        return [
          '/tmp/agents/fox/SOUL.md',
          '/tmp/agents/fox/.working-memory',
        ].includes(normalized);
      });
      vi.mocked(fs.readFileSync).mockImplementation((candidate) => {
        const normalized = String(candidate).replace(/\\/g, '/');
        if (normalized.endsWith('SOUL.md')) return 'No heading here.';
        if (normalized.endsWith('memory.md')) return '# Memory\nCurated memory';
        return '';
      });
      vi.mocked(fs.readdirSync).mockImplementation((candidate) => {
        const normalized = String(candidate).replace(/\\/g, '/');
        if (normalized.endsWith('/.working-memory')) {
          return ['memory.md'] as unknown as ReturnType<typeof fs.readdirSync>;
        }
        return [] as unknown as ReturnType<typeof fs.readdirSync>;
      });

      const composer = { compose: vi.fn(() => '# Memory\nCurated memory') };
      const customLoader = new IdentityLoader(() => [], composer);
      const result = customLoader.load('/tmp/agents/fox');

      expect(result?.name).toBe('fox');
      expect(result?.systemMessage).toContain('# Memory');
    });

    it('returns null when nothing exists', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      expect(loader.load('/tmp/test')).toBeNull();
    });

    it('appends a Tools section when installed tools are provided', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('# Q\nI am an agent.');
      vi.mocked(fs.readdirSync).mockReturnValue([]);
      const tools: InstalledTool[] = [{
        id: 'workiq',
        package: '@microsoft/workiq',
        version: 'latest',
        bin: 'workiq',
        displayName: 'Microsoft Work IQ',
        description: 'Query M365 data.',
        help: 'workiq ask --help',
        agentInstructions: 'Use `workiq ask "<question>"`.',
        source: { marketplaceId: 'github:ianphil/genesis-minds', pluginId: 'genesis-minds' },
        installedAt: '2026-05-07T21:00:00.000Z',
      }];
      const withTools = new IdentityLoader(() => tools);
      const result = withTools.load('/tmp/test');
      expect(result?.systemMessage).toContain('## Tools');
      expect(result?.systemMessage).toContain('### workiq — Microsoft Work IQ');
      expect(result?.systemMessage).toContain('workiq ask --help');
    });

    it('does not append a Tools section when no tools are installed', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('# Q\nI am an agent.');
      vi.mocked(fs.readdirSync).mockReturnValue([]);
      const result = new IdentityLoader(() => []).load('/tmp/test');
      expect(result?.systemMessage).not.toContain('## Tools');
      expect(result?.systemMessage).toContain('## Chamber');
    });

    it('appends Chamber guidance before installed tool guidance', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('# Q\nI am an agent.');
      vi.mocked(fs.readdirSync).mockReturnValue([]);
      const tools: InstalledTool[] = [{
        id: 'workiq',
        package: '@microsoft/workiq',
        version: 'latest',
        bin: 'workiq',
        displayName: 'Microsoft Work IQ',
        description: 'Query M365 data.',
        source: { marketplaceId: 'github:ianphil/genesis-minds', pluginId: 'genesis-minds' },
        installedAt: '2026-05-07T21:00:00.000Z',
      }];

      const result = new IdentityLoader(() => tools).load('/tmp/test');
      const systemMessage = result?.systemMessage ?? '';

      expect(systemMessage.indexOf('## Chamber')).toBeGreaterThan(systemMessage.indexOf('# Q'));
      expect(systemMessage.indexOf('## Tools')).toBeGreaterThan(systemMessage.indexOf('## Chamber'));
    });

    it('uses a default WorkingMemoryComposer when none injected', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.readFileSync).mockReturnValue('');
      vi.mocked(fs.readdirSync).mockReturnValue([]);
      // Should not throw — proves the default composer is constructed and called.
      const defaultLoader = new IdentityLoader();
      expect(() => defaultLoader.load('/tmp/test')).not.toThrow();
    });

    it('forwards mindPath and resolved config defaults to the composer', () => {
      vi.mocked(fs.existsSync).mockImplementation((candidate) => {
        const normalized = String(candidate).replace(/\\/g, '/');
        return normalized.endsWith('SOUL.md');
      });
      vi.mocked(fs.readFileSync).mockReturnValue('# Soul');
      vi.mocked(fs.readdirSync).mockReturnValue([]);
      const composer = { compose: vi.fn(() => '') };
      const loader2 = new IdentityLoader(() => [], composer);
      loader2.load('/tmp/agents/widget');

      expect(composer.compose).toHaveBeenCalledWith(
        '/tmp/agents/widget',
        {
          // Defaults from chamberMindConfig (Phase 4) when no .chamber.json exists.
          // Phase 1 of v0.60.0 added `enabled` (strict opt-in for the dream daemon).
          enabled: false,
          lastKTurns: 10,
          perTurnMaxBytes: 2048,
          memoryMaxBytes: 8192,
        },
      );
    });

    it('backward compat: builds a system prompt when composer returns empty', () => {
      vi.mocked(fs.existsSync).mockImplementation((candidate) => {
        const normalized = String(candidate).replace(/\\/g, '/');
        return normalized.endsWith('SOUL.md');
      });
      vi.mocked(fs.readFileSync).mockReturnValue('# Mind\nIdentity body');
      vi.mocked(fs.readdirSync).mockReturnValue([]);
      const composer = { compose: vi.fn(() => '') };
      const loader2 = new IdentityLoader(() => [], composer);
      const result = loader2.load('/tmp/test');

      expect(result).not.toBeNull();
      expect(result?.systemMessage).toContain('Identity body');
      expect(result?.systemMessage).toContain('## Chamber');
    });

    it('backward compat: does not crash when composer throws', () => {
      vi.mocked(fs.existsSync).mockImplementation((candidate) => {
        const normalized = String(candidate).replace(/\\/g, '/');
        return normalized.endsWith('SOUL.md');
      });
      vi.mocked(fs.readFileSync).mockReturnValue('# Soul');
      vi.mocked(fs.readdirSync).mockReturnValue([]);
      const composer = {
        compose: vi.fn(() => {
          throw new Error('composer boom');
        }),
      };
      const loader2 = new IdentityLoader(() => [], composer);
      expect(() => loader2.load('/tmp/test')).not.toThrow();
      const result = loader2.load('/tmp/test');
      expect(result?.systemMessage).toContain('# Soul');
    });
  });
});
