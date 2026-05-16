import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import packageJson from '../../package.json';
import {
  PACKAGED_RENDERER_ENTRY,
  PACKAGED_RENDERER_NAME,
  PACKAGED_RENDERER_RELATIVE_DIR,
} from '../../config/packaged-renderer.cjs';

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
    expect(packageJson.scripts['make:builder:mac']).toContain(
      '--prepackaged out/Chamber-darwin-$(node -p "process.arch")/Chamber.app'
    );
    expect(packageJson.scripts['make:builder:mac']).toContain('scripts/sign-macos-prepackaged.js');
    expect(packageJson.scripts['make:builder:mac']).toContain('scripts/notarize-macos-prepackaged.js');
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
    const prepareNodeRuntime = readFileSync('scripts/prepare-node-runtime.js', 'utf-8');
    const signMacPrepackaged = readFileSync('scripts/sign-macos-prepackaged.js', 'utf-8');
    const notarizeMacPrepackaged = readFileSync('scripts/notarize-macos-prepackaged.js', 'utf-8');
    const validateBuilder = readFileSync('scripts/validate-builder-release.js', 'utf-8');
    const releaseWorkflow = readFileSync('.github/workflows/release.yml', 'utf-8');
    const windowsPublisher = readFileSync('config/windows-publisher.cjs', 'utf-8');

    expect(builderConfig).toContain('signtoolOptions');
    expect(builderConfig).toContain('sign-windows-trusted-signing.js');
    expect(builderConfig).toContain('resolveMacIdentity');
    expect(builderConfig).toContain('Developer ID Application:');
    expect(builderConfig).toContain("target: ['dmg', 'zip']");
    expect(builderConfig).toContain('resolvePublishTargets');
    expect(builderConfig).toContain('CHAMBER_RELEASE_CHANNEL');
    expect(builderConfig).toContain('CHAMBER_BUILDER_UPDATE_URL');
    expect(builderConfig).not.toContain('azureSignOptions');

    const bumpInsiders = readFileSync('scripts/bump-insiders-version.js', 'utf-8');
    expect(bumpInsiders).toContain("INSIDERS_TAG = 'insiders'");
    expect(bumpInsiders).toContain("'npm', ['version', nextVersion, '--no-git-tag-version']");
    expect(bumpInsiders).toContain("'npm', ['install']");
    expect(bumpInsiders).not.toContain('--package-lock-only');
    expect(windowsPublisher).toContain('CN=Ian Philpot');
    expect(prepareBuilder).toContain('publisherName:');
    expect(prepareBuilder).toContain('CHAMBER_WINDOWS_SIGNING');
    expect(prepareBuilder).toContain('CHAMBER_RELEASE_CHANNEL');
    expect(prepareBuilder).toContain('CHAMBER_BUILDER_UPDATE_URL');
    expect(prepareBuilder).toContain('provider: generic');
    expect(prepareBuilder).toContain("path.join(outputDir, 'Chamber.app')");
    expect(prepareNodeRuntime).toContain('dereference: true');
    expect(prepareNodeRuntime).toContain('materializeRuntimeCommandSymlinks');
    expect(signMacPrepackaged).toContain('electron-osx-sign');
    expect(signMacPrepackaged).toContain('CHAMBER_MACOS_SIGNING');
    expect(notarizeMacPrepackaged).toContain('notarytool');
    expect(notarizeMacPrepackaged).toContain('CHAMBER_NOTARY_KEYCHAIN_PROFILE');
    expect(notarizeMacPrepackaged).toContain('CHAMBER_NOTARIZATION_TIMEOUT');
    expect(notarizeMacPrepackaged).toContain('--keychain-profile');
    expect(notarizeMacPrepackaged).toContain('--timeout');
    expect(notarizeMacPrepackaged).toContain('stapler');
    expect(notarizeMacPrepackaged).toContain('APPLE_APP_SPECIFIC_PASSWORD');
    expect(validateBuilder).toContain('assertAppUpdatePublisherName');
    expect(validateBuilder).toContain('matchesPublisherName');
    expect(validateBuilder).toContain('SignerCertificate.Subject');
    expect(releaseWorkflow).toContain('azure/login@v2');
    expect(releaseWorkflow).toContain('CHAMBER_REQUIRE_WINDOWS_SIGNATURE');
    expect(releaseWorkflow).toContain('Import macOS signing certificate');
    expect(releaseWorkflow).toContain('DeveloperIDG2CA.cer');
    expect(releaseWorkflow).toContain('security add-certificates -k "$keychain" "$intermediate" || true');
    expect(releaseWorkflow).toContain('security import "$certificate"');
    expect(releaseWorkflow).toContain('security set-key-partition-list');
    expect(releaseWorkflow).toContain('notarytool store-credentials chamber-notary');
    expect(releaseWorkflow).toContain('CHAMBER_NOTARY_KEYCHAIN_PROFILE: chamber-notary');
    expect(releaseWorkflow).toContain('name: release-macos');
    expect(releaseWorkflow).toContain('runs-on: macos-latest');
    expect(releaseWorkflow).toContain('build_macos_x64');
    expect(releaseWorkflow).toContain('runs-on: macos-13');
    expect(releaseWorkflow).toContain("github.event_name == 'workflow_dispatch' && inputs.build_macos_x64");
    expect(releaseWorkflow).toContain('release-macos-x64');
    expect(releaseWorkflow).toContain("needs['build-macos-x64'].result == 'skipped'");
    expect(releaseWorkflow).not.toContain('AZURE_CLIENT_SECRET');
  });

  it('shares the packaged renderer path across Forge, Vite, and sandbox preflight', () => {
    const forgeConfig = readFileSync('forge.config.ts', 'utf-8');
    const viteElectronConfig = readFileSync('apps/web/vite.electron.config.ts', 'utf-8');
    const sandboxTest = readFileSync('scripts/sandbox-test.js', 'utf-8');

    expect(PACKAGED_RENDERER_NAME).toBe('main_window');
    expect(PACKAGED_RENDERER_RELATIVE_DIR).toBe(`.vite/renderer/${PACKAGED_RENDERER_NAME}`);
    expect(PACKAGED_RENDERER_ENTRY).toBe(
      `/${PACKAGED_RENDERER_RELATIVE_DIR}/index.html`
    );
    expect(forgeConfig).toContain('PACKAGED_RENDERER_NAME');
    expect(viteElectronConfig).toContain('PACKAGED_RENDERER_RELATIVE_DIR');
    expect(sandboxTest).toContain('PACKAGED_RENDERER_ENTRY');
    expect(sandboxTest).not.toContain('/.vite/renderer/main_window/index.html');
  });
});
