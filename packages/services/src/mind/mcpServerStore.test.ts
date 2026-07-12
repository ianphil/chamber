import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { McpServerEntry } from '@chamber/shared/mcp-types';
import { readMcpServers, writeMcpServers } from './mcpServerStore';
import { loadMcpServersFromMindPath, MCP_CONFIG_FILENAME } from './mcpConfig';

describe('mcpServerStore', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-mcp-store-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeFile(value: unknown): void {
    fs.writeFileSync(path.join(tmpDir, MCP_CONFIG_FILENAME), JSON.stringify(value), 'utf-8');
  }

  function readFile(): Record<string, unknown> {
    return JSON.parse(fs.readFileSync(path.join(tmpDir, MCP_CONFIG_FILENAME), 'utf-8'));
  }

  function readServers(): Record<string, Record<string, unknown>> {
    return readFile().mcpServers as Record<string, Record<string, unknown>>;
  }

  describe('readMcpServers', () => {
    it('returns an empty array when the file is absent', () => {
      expect(readMcpServers(tmpDir)).toEqual([]);
    });

    it('surfaces stdio and http servers sorted by name', () => {
      writeFile({
        mcpServers: {
          zeta: { type: 'http', url: 'https://mcp.example.test/v1', headers: { Authorization: 'token' } },
          alpha: { command: 'npx', args: ['-y', 'server'], env: { ROOT: '/tmp' } },
        },
      });

      expect(readMcpServers(tmpDir)).toEqual([
        { name: 'alpha', transport: 'stdio', command: 'npx', args: ['-y', 'server'], env: { ROOT: '/tmp' } },
        {
          name: 'zeta',
          transport: 'http',
          url: 'https://mcp.example.test/v1',
          headers: { Authorization: 'token' },
          preserved: { type: 'http' },
        },
      ]);
    });

    it('captures tools, timeout, and cwd as preserved fields', () => {
      writeFile({
        mcpServers: {
          files: { type: 'stdio', command: 'npx', args: [], tools: ['read'], timeout: 5000, cwd: '/work' },
        },
      });

      expect(readMcpServers(tmpDir)).toEqual([
        {
          name: 'files',
          transport: 'stdio',
          command: 'npx',
          args: [],
          env: {},
          preserved: { type: 'stdio', tools: ['read'], timeout: 5000, cwd: '/work' },
        },
      ]);
    });

    it('omits entries the runtime schema would reject (not surfaced as editable)', () => {
      writeFile({
        mcpServers: {
          good: { command: 'real-cli' },
          missingType: { url: 'https://mcp.example.test' }, // http requires type
          unknownKey: { command: 'x', bogus: true }, // strict schema rejects
        },
      });

      expect(readMcpServers(tmpDir).map((entry) => entry.name)).toEqual(['good']);
    });

    it('agrees with the runtime loader on which entries are valid', () => {
      writeFile({
        mcpServers: {
          good: { command: 'real-cli' },
          broken: { type: 'stdio' }, // missing command
        },
      });

      const managed = readMcpServers(tmpDir).map((entry) => entry.name).sort();
      const runtime = Object.keys(loadMcpServersFromMindPath(tmpDir)).sort();
      expect(managed).toEqual(runtime);
    });
  });

  describe('writeMcpServers', () => {
    it('persists stdio and http entries with an explicit type', () => {
      const entries: McpServerEntry[] = [
        { name: 'files', transport: 'stdio', command: 'npx', args: ['-y', 'fs'], env: { ROOT: '/tmp' } },
        { name: 'remote', transport: 'http', url: 'https://mcp.example.test', headers: { Authorization: 'k' } },
      ];

      writeMcpServers(tmpDir, entries);

      expect(readServers()).toEqual({
        files: { type: 'stdio', command: 'npx', args: ['-y', 'fs'], env: { ROOT: '/tmp' } },
        remote: { type: 'http', url: 'https://mcp.example.test', headers: { Authorization: 'k' } },
      });
    });

    it('omits env and headers when they are empty', () => {
      writeMcpServers(tmpDir, [
        { name: 'files', transport: 'stdio', command: 'cli', args: [], env: {} },
      ]);
      expect(Object.prototype.hasOwnProperty.call(readServers().files, 'env')).toBe(false);
    });

    it('preserves unknown top-level keys across a write', () => {
      writeFile({ $schema: 'https://schema.test', mcpServers: {} });
      writeMcpServers(tmpDir, [
        { name: 'files', transport: 'stdio', command: 'cli', args: [], env: {} },
      ]);
      expect(readFile().$schema).toBe('https://schema.test');
    });

    it('preserves invalid/unsupported raw entries verbatim (blocker 1)', () => {
      writeFile({
        mcpServers: {
          weird: { command: 'x', bogus: true, nested: { a: 1 } }, // not runtime-valid
        },
      });

      writeMcpServers(tmpDir, [
        { name: 'files', transport: 'stdio', command: 'cli', args: [], env: {} },
      ]);

      const servers = readServers();
      expect(servers.weird).toEqual({ command: 'x', bogus: true, nested: { a: 1 } });
      expect(servers.files).toEqual({ type: 'stdio', command: 'cli', args: [] });
    });

    it('does not normalize a skipped invalid entry into an executable config', () => {
      writeFile({ mcpServers: { broken: { type: 'stdio' } } }); // missing command
      // Re-saving the (empty) managed set must leave the invalid entry as-is,
      // never turning it into a runnable server.
      writeMcpServers(tmpDir, readMcpServers(tmpDir));
      expect(readServers().broken).toEqual({ type: 'stdio' });
      expect(loadMcpServersFromMindPath(tmpDir)).toEqual({});
    });

    it('keeps the tools allowlist when a server is renamed (blocker 2)', () => {
      writeFile({
        mcpServers: {
          old: { type: 'stdio', command: 'npx', args: [], tools: ['read'], timeout: 5000, cwd: '/work' },
        },
      });

      const [entry] = readMcpServers(tmpDir);
      // Rename carries the preserved bag with the entry.
      writeMcpServers(tmpDir, [{ ...entry, name: 'renamed' }]);

      const servers = readServers();
      expect(servers.old).toBeUndefined();
      expect(servers.renamed).toEqual({
        type: 'stdio',
        command: 'npx',
        args: [],
        cwd: '/work',
        tools: ['read'],
        timeout: 5000,
      });
    });

    it('does not widen tools to all when editing a scoped server', () => {
      writeFile({
        mcpServers: { svc: { type: 'stdio', command: 'old', args: [], tools: ['read'] } },
      });
      const [entry] = readMcpServers(tmpDir);
      writeMcpServers(tmpDir, [{ ...entry, command: 'new' } as McpServerEntry]);

      const loaded = loadMcpServersFromMindPath(tmpDir);
      expect(loaded.svc.tools).toEqual(['read']);
    });

    it('preserves an sse server type rather than rewriting it as http (blocker 4)', () => {
      writeFile({
        mcpServers: {
          stream: { type: 'sse', url: 'https://mcp.example.test/sse', tools: ['ping'] },
        },
      });

      const [entry] = readMcpServers(tmpDir);
      expect(entry.preserved?.type).toBe('sse');

      // Edit the URL and rename; the sse type must survive serialization.
      writeMcpServers(tmpDir, [
        { ...entry, name: 'renamed-stream', url: 'https://mcp.example.test/sse2' } as McpServerEntry,
      ]);

      expect(readServers()['renamed-stream']).toEqual({
        type: 'sse',
        url: 'https://mcp.example.test/sse2',
        tools: ['ping'],
      });
    });

    it('clamps a stale sse type to http when the entry becomes stdio', () => {
      writeMcpServers(tmpDir, [
        {
          name: 'svc',
          transport: 'stdio',
          command: 'cli',
          args: [],
          env: {},
          preserved: { type: 'sse', tools: ['read'] },
        },
      ]);
      expect(readServers().svc).toEqual({ type: 'stdio', command: 'cli', args: [], tools: ['read'] });
    });

    it('rejects empty names', () => {
      expect(() => writeMcpServers(tmpDir, [
        { name: '  ', transport: 'stdio', command: 'cli', args: [], env: {} },
      ])).toThrow(/name must not be empty/);
    });

    it('rejects duplicate names', () => {
      expect(() => writeMcpServers(tmpDir, [
        { name: 'dup', transport: 'stdio', command: 'a', args: [], env: {} },
        { name: 'dup', transport: 'http', url: 'https://b.test', headers: {} },
      ])).toThrow(/Duplicate MCP server name: dup/);
    });

    it('round-trips a stdio entry through readMcpServers', () => {
      const entries: McpServerEntry[] = [
        { name: 'files', transport: 'stdio', command: 'npx', args: ['fs'], env: { A: '1' }, preserved: { type: 'stdio' } },
      ];
      writeMcpServers(tmpDir, entries);
      expect(readMcpServers(tmpDir)).toEqual(entries);
    });
  });
});
