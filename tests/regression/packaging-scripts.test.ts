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
    // Model B: bump computes target stable from CHANGELOG ## Unreleased,
    // then appends -insiders.<N> using existing tag history.
    expect(bumpInsiders).toContain("require('./changelog')");
    expect(bumpInsiders).toContain('recommendBumpFromChangelog');
    expect(bumpInsiders).toContain('listInsiderCountersForBase');
    expect(bumpInsiders).toContain('stableTagExists');
    expect(bumpInsiders).toContain('--allow-same-version');
    expect(bumpInsiders).toContain("'npm', ['install']");
    expect(bumpInsiders).not.toContain('--package-lock-only');
    // Model B invariant: master must hold a clean (non-prerelease) version.
    expect(bumpInsiders).toContain('Master must hold the last shipped stable version');

    const validateBuilderChannel = readFileSync('scripts/validate-builder-release.js', 'utf-8');
    expect(validateBuilderChannel).toContain("args.get('channel') ?? 'latest'");
    expect(validateBuilderChannel).toContain('`${channel}.yml`');

    const insidersWorkflow = readFileSync('.github/workflows/release-insiders.yml', 'utf-8');
    expect(insidersWorkflow).toContain('name: Release Insiders');
    expect(insidersWorkflow).toContain('workflow_dispatch:');
    expect(insidersWorkflow).toContain('CHAMBER_RELEASE_CHANNEL: insiders');
    expect(insidersWorkflow).toContain('CHAMBER_BUILDER_UPDATE_URL');
    expect(insidersWorkflow).toContain('https://chamberinsiders.blob.core.windows.net/releases/');
    expect(insidersWorkflow).toContain('bump-insiders-version.js');
    expect(insidersWorkflow).toContain('--override-bump=');
    expect(insidersWorkflow).toContain('override_bump:');
    expect(insidersWorkflow).toContain('client-id: ${{ vars.AZURE_CLIENT_ID }}');
    expect(insidersWorkflow).toContain('az storage blob upload-batch');
    expect(insidersWorkflow).toContain('--auth-mode login');
    expect(insidersWorkflow).toContain('Chamber-Setup-latest-insiders.exe');
    expect(insidersWorkflow).toContain('--channel=insiders');
    expect(insidersWorkflow).toContain('insiders.yml');
    expect(insidersWorkflow).toContain('build-macos:');
    expect(insidersWorkflow).toContain('runs-on: macos-latest');
    expect(insidersWorkflow).toContain('tag: ${{ steps.bump.outputs.tag }}');
    expect(insidersWorkflow).toContain('git push origin "${{ needs.prepare.outputs.tag }}"');
    expect(insidersWorkflow).not.toContain('git push origin HEAD');
    expect(insidersWorkflow).not.toContain('softprops/action-gh-release');
    // Model B: the tag points at master's SHA, not a synthetic
    // version-bump commit. The Tag step must not commit package.json.
    expect(insidersWorkflow).not.toMatch(/git\s+add\s+package\.json/);
    expect(insidersWorkflow).not.toMatch(/git\s+commit\s+-m\s+["']chore\(release\):/);

    const stableWorkflow = readFileSync('.github/workflows/release.yml', 'utf-8');
    expect(stableWorkflow).toContain('source_ref:');
    expect(stableWorkflow).not.toMatch(/on:\s*\n\s*push:/);
    // Model B: stable version derived from insider tag name (master pkg.json
    // is stale between releases) or computed from ## Unreleased.
    expect(stableWorkflow).toContain('INSIDER_TAG_REGEX');
    expect(stableWorkflow).toContain('recommendBumpFromChangelog');
    expect(stableWorkflow).toContain('ref: ${{ needs.check-version.outputs.source_ref }}');
    expect(stableWorkflow).toContain('Apply promoted version');
    expect(stableWorkflow).toContain('--allow-same-version');
    expect(stableWorkflow).toContain('promoted_from');
    expect(stableWorkflow).toContain("--exclude='*-insiders.*'");
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
    expect(releaseWorkflow).toMatch(/azure\/login@[0-9a-f]{40}\s+#\s*v2\b/);
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
