import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

describe('.gitignore', () => {
  it('ignores generated workspace dist artifacts', async () => {
    await expect(
      execFileAsync('git', [
        'check-ignore',
        'apps/server/dist/bin.mjs',
        'apps/web/dist/index.html',
      ])
    ).resolves.toBeDefined();
  });
});
