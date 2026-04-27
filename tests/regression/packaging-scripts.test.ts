import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import packageJson from '../../package.json';

describe('packaging scripts', () => {
  it('builds generated server resources before Electron Forge packaging commands', () => {
    for (const scriptName of ['package', 'make', 'publish'] as const) {
      const script = packageJson.scripts[scriptName];

      expect(script).toContain('npm --workspace @chamber/server run build');
      expect(script.indexOf('npm --workspace @chamber/server run build')).toBeLessThan(
        script.indexOf('electron-forge')
      );
    }
  });

  it('runs PR packaging only for major or minor version bumps', () => {
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf-8');

    expect(workflow).toContain('id: version-bump');
    expect(workflow).toContain('$headVersion.Major -gt $baseVersion.Major');
    expect(workflow).toContain('$headVersion.Minor -gt $baseVersion.Minor');
    expect(workflow).toContain("if: steps.version-bump.outputs.run-package == 'true'");
    expect(workflow).toContain('run: npm run package');
  });
});
