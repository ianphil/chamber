import { describe, it, expect } from 'vitest';
import type { McpServerEntry } from '@chamber/shared/mcp-types';
import {
  emptyMcpForm,
  entryToForm,
  formToEntry,
  parseArgs,
  parseKeyValues,
  formatKeyValues,
  validateMcpForm,
} from './mcpFormUtils';

describe('mcpFormUtils', () => {
  describe('parseArgs', () => {
    it('splits non-empty trimmed lines into arguments', () => {
      expect(parseArgs('-y\n  @scope/pkg  \n\n--flag')).toEqual(['-y', '@scope/pkg', '--flag']);
    });

    it('returns an empty array for blank text', () => {
      expect(parseArgs('   \n  ')).toEqual([]);
    });
  });

  describe('parseKeyValues', () => {
    it('parses KEY=VALUE lines and keeps the first separator', () => {
      expect(parseKeyValues('ROOT=/tmp\nTOKEN=a=b=c')).toEqual({ ROOT: '/tmp', TOKEN: 'a=b=c' });
    });

    it('treats a keyless line as an empty value and skips blanks', () => {
      expect(parseKeyValues('FLAG\n\n  ')).toEqual({ FLAG: '' });
    });
  });

  describe('formatKeyValues', () => {
    it('round-trips with parseKeyValues', () => {
      const record = { A: '1', B: 'two' };
      expect(parseKeyValues(formatKeyValues(record))).toEqual(record);
    });
  });

  describe('entryToForm / formToEntry', () => {
    it('round-trips a stdio entry', () => {
      const entry: McpServerEntry = {
        name: 'files',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', 'server'],
        env: { ROOT: '/tmp' },
      };
      expect(formToEntry(entryToForm(entry))).toEqual(entry);
    });

    it('round-trips an http entry', () => {
      const entry: McpServerEntry = {
        name: 'remote',
        transport: 'http',
        url: 'https://mcp.example.test/v1',
        headers: { Authorization: 'token' },
      };
      expect(formToEntry(entryToForm(entry))).toEqual(entry);
    });

    it('round-trips preserved fields (tools/type) across the form', () => {
      const entry: McpServerEntry = {
        name: 'stream',
        transport: 'http',
        url: 'https://mcp.example.test/sse',
        headers: {},
        preserved: { type: 'sse', tools: ['ping'] },
      };
      expect(formToEntry(entryToForm(entry))).toEqual(entry);
    });

    it('trims the name and command when building an entry', () => {
      const form = { ...emptyMcpForm(), name: '  files  ', command: '  npx  ' };
      expect(formToEntry(form)).toEqual({ name: 'files', transport: 'stdio', command: 'npx', args: [], env: {} });
    });
  });

  describe('validateMcpForm', () => {
    it('requires a name', () => {
      expect(validateMcpForm({ ...emptyMcpForm(), name: '  ' }, [])).toMatch(/name is required/i);
    });

    it('rejects a duplicate name', () => {
      const form = { ...emptyMcpForm(), name: 'files', command: 'npx' };
      expect(validateMcpForm(form, ['files'])).toMatch(/already exists/i);
    });

    it('requires a command for stdio', () => {
      expect(validateMcpForm({ ...emptyMcpForm(), name: 'x', command: '' }, [])).toMatch(/command is required/i);
    });

    it('requires a valid url for http', () => {
      expect(validateMcpForm({ ...emptyMcpForm(), name: 'x', transport: 'http', url: 'not-a-url' }, []))
        .toMatch(/valid url/i);
    });

    it('accepts a valid stdio form', () => {
      expect(validateMcpForm({ ...emptyMcpForm(), name: 'x', command: 'npx' }, [])).toBeNull();
    });

    it('accepts a valid http form', () => {
      expect(validateMcpForm({ ...emptyMcpForm(), name: 'x', transport: 'http', url: 'https://a.test' }, []))
        .toBeNull();
    });
  });
});
