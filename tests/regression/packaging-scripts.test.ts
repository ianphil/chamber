import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import packageJson from '../../package.json';

describe('packaging scripts', () => {
  it('builds generated server resources before Electron packaging commands', () => {
    for (const scriptName of ['package', 'make:forge', 'publish'] as const) {
      const script = packageJson.scripts[scriptName];

      expect(script).toContain('npm --workspace @chamber/server run build');
      expect(script.indexOf('npm --workspace @chamber/server run build')).toBeLessThan(
        script.indexOf('electron-forge')
      );
    }

    expect(packageJson.scripts.make).toBe('npm run make:builder');
    expect(packageJson.scripts['make:builder']).toContain('npm run package');
    expect(packageJson.scripts['make:builder'].indexOf('npm run package')).toBeLessThan(
      packageJson.scripts['make:builder'].indexOf('electron-builder')
    );
  });

  it('runs PR packaging only for major or minor version bumps', () => {
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf-8');

    expect(workflow).toContain('id: version-bump');
    expect(workflow).toContain('$headVersion.Major -gt $baseVersion.Major');
    expect(workflow).toContain('$headVersion.Minor -gt $baseVersion.Minor');
    expect(workflow).toContain("if: steps.version-bump.outputs.run-package == 'true'");
    expect(workflow).toContain('run: npm run package');
  });

  it('keeps signed updater verification wired into builder releases', () => {
    const builderConfig = readFileSync('config/electron-builder.config.cjs', 'utf-8');
    const prepareBuilder = readFileSync('scripts/prepare-builder-prepackaged.js', 'utf-8');
    const validateBuilder = readFileSync('scripts/validate-builder-release.js', 'utf-8');
    const releaseWorkflow = readFileSync('.github/workflows/release.yml', 'utf-8');

    expect(builderConfig).toContain('signtoolOptions');
    expect(builderConfig).toContain('sign-windows-trusted-signing.js');
    expect(builderConfig).not.toContain('azureSignOptions');
    expect(prepareBuilder).toContain('publisherName:');
    expect(prepareBuilder).toContain('CHAMBER_WINDOWS_SIGNING');
    expect(validateBuilder).toContain('assertAppUpdatePublisherName');
    expect(validateBuilder).toContain('matchesPublisherName');
    expect(validateBuilder).toContain('SignerCertificate.Subject');
    expect(releaseWorkflow).toContain('azure/login@v2');
    expect(releaseWorkflow).toContain('CHAMBER_REQUIRE_WINDOWS_SIGNATURE');
    expect(releaseWorkflow).not.toContain('AZURE_CLIENT_SECRET');
  });
});
