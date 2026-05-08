import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadMcpServersFromMindPath, MCP_CONFIG_FILENAME } from './mcpConfig';

describe('loadMcpServersFromMindPath', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-mcp-config-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeConfig(value: unknown): void {
    fs.writeFileSync(path.join(tmpDir, MCP_CONFIG_FILENAME), JSON.stringify(value), 'utf-8');
  }

  it('returns an empty object when .mcp.json does not exist', () => {
    expect(loadMcpServersFromMindPath(tmpDir)).toEqual({});
  });

  it('reads stdio servers and defaults tools to ["*"]', () => {
    writeConfig({
      mcpServers: {
        filesystem: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem'],
          env: { ROOT: '/tmp' },
        },
      },
    });

    expect(loadMcpServersFromMindPath(tmpDir)).toEqual({
      filesystem: {
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem'],
        env: { ROOT: '/tmp' },
        tools: ['*'],
      },
    });
  });

  it('reads HTTP servers and preserves the type', () => {
    writeConfig({
      mcpServers: {
        remote: {
          type: 'http',
          url: 'https://mcp.example.test/v1',
          headers: { Authorization: 'Bearer abc' },
          tools: ['ping', 'pong'],
        },
      },
    });

    expect(loadMcpServersFromMindPath(tmpDir)).toEqual({
      remote: {
        type: 'http',
        url: 'https://mcp.example.test/v1',
        headers: { Authorization: 'Bearer abc' },
        tools: ['ping', 'pong'],
      },
    });
  });

  it('drops only the invalid entry and keeps valid ones (per-entry validation, #199)', () => {
    writeConfig({
      mcpServers: {
        good: { command: 'real-cli' },
        broken: { type: 'stdio' }, // missing command
        alsoGood: {
          type: 'http',
          url: 'https://mcp.example.test/v2',
        },
      },
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const servers = loadMcpServersFromMindPath(tmpDir);
      expect(Object.keys(servers).sort()).toEqual(['alsoGood', 'good']);
      expect(servers.good).toMatchObject({ command: 'real-cli' });
      expect(servers.alsoGood).toMatchObject({ url: 'https://mcp.example.test/v2' });
      // The dropped entry must be named in the warning so authors know
      // which key to fix. Logger prefixes with the tag so the message
      // string lives at index 1.
      expect(warn.mock.calls.some(args =>
        args.some(arg => typeof arg === 'string' && arg.includes('"broken"')),
      )).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it('rejects entries that mix stdio and http keys (no silent union coercion)', () => {
    writeConfig({
      mcpServers: {
        confused: {
          command: 'evil',
          url: 'http://attacker.example/',
        },
      },
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      expect(loadMcpServersFromMindPath(tmpDir)).toEqual({});
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('returns empty without throwing when JSON is invalid', () => {
    fs.writeFileSync(path.join(tmpDir, MCP_CONFIG_FILENAME), '{not json', 'utf-8');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      expect(loadMcpServersFromMindPath(tmpDir)).toEqual({});
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('returns empty when the only entry fails schema validation (e.g. missing command and url)', () => {
    writeConfig({
      mcpServers: {
        broken: { type: 'stdio' },
      },
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      expect(loadMcpServersFromMindPath(tmpDir)).toEqual({});
      // Per-entry validation: the warning must reference the entry name,
      // not the file globally.
      expect(warn.mock.calls.some(args =>
        args.some(arg => typeof arg === 'string' && arg.includes('"broken"')),
      )).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it('returns empty when mcpServers is absent', () => {
    writeConfig({});
    expect(loadMcpServersFromMindPath(tmpDir)).toEqual({});
  });

  it('omits optional fields rather than passing undefined values', () => {
    writeConfig({
      mcpServers: {
        bare: { command: 'cli' },
      },
    });

    const servers = loadMcpServersFromMindPath(tmpDir);
    expect(servers.bare).toEqual({
      type: 'stdio',
      command: 'cli',
      args: [],
      tools: ['*'],
    });
    expect(Object.prototype.hasOwnProperty.call(servers.bare, 'env')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(servers.bare, 'cwd')).toBe(false);
  });
});
