import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', () => ({ existsSync: vi.fn(), readFileSync: vi.fn(), readdirSync: vi.fn() }));
vi.mock('child_process', () => ({ execSync: vi.fn() }));

import * as fs from 'fs';
import { parseNpmrcPrefix } from './SdkDiscovery';

describe('parseNpmrcPrefix', () => {
  beforeEach(() => vi.clearAllMocks());

  it('extracts prefix from .npmrc content', () => {
    vi.mocked(fs.readFileSync).mockReturnValue('prefix=C:\\Users\\test\\npm-global\n');
    expect(parseNpmrcPrefix('C:\\Users\\test\\.npmrc')).toBe('C:\\Users\\test\\npm-global');
  });

  it('returns null when file does not exist', () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => { throw new Error('ENOENT'); });
    expect(parseNpmrcPrefix('missing')).toBeNull();
  });

  it('returns null when no prefix line', () => {
    vi.mocked(fs.readFileSync).mockReturnValue('registry=https://registry.npmjs.org\n');
    expect(parseNpmrcPrefix('some-file')).toBeNull();
  });
});
