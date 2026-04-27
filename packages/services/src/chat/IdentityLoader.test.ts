import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
}));

import * as fs from 'fs';
import { IdentityLoader } from './IdentityLoader';

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
        systemMessage: '# Q\nI am an agent.',
      });
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

      const result = loader.load('/tmp/test');

      expect(result?.systemMessage).toContain('Curated memory');
      expect(result?.systemMessage).toContain('Operational rule');
      expect(result?.systemMessage).toContain('Chronological note');
    });

    it('returns null when nothing exists', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      expect(loader.load('/tmp/test')).toBeNull();
    });
  });
});
