import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

import * as fs from 'fs';
import { seedLensDefaults, installLensSkill } from './MindBootstrap';

describe('seedLensDefaults', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates views when missing', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    seedLensDefaults('C:\\test\\mind');
    expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalled();
  });

  it('skips when views exist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    seedLensDefaults('C:\\test\\mind');
    expect(vi.mocked(fs.writeFileSync)).not.toHaveBeenCalled();
  });
});
