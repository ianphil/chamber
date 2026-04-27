import { describe, expect, it } from 'vitest';

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
});
