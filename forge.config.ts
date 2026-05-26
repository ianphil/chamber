import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { PACKAGED_RENDERER_NAME } from './config/packaged-renderer.cjs';

const APP_ICON_PATH = path.resolve(__dirname, 'assets', 'app');
const WINDOWS_ICON_PATH = `${APP_ICON_PATH}.ico`;

function prepareCopilotRuntime(platform: string, arch: string): void {
  const scriptPath = path.resolve(__dirname, 'scripts', 'prepare-copilot-runtime.js');
  const result = spawnSync(process.execPath, [
    scriptPath,
    '--platform',
    platform,
    '--arch',
    arch,
  ], {
    stdio: 'inherit',
    windowsHide: true,
  });

  if (result.status !== 0) {
    throw new Error(`Failed to prepare packaged Copilot runtime for ${platform}-${arch}.`);
  }
}

function prepareSharpRuntime(platform: string, arch: string): void {
  const scriptPath = path.resolve(__dirname, 'scripts', 'prepare-sharp-runtime.js');
  const result = spawnSync(process.execPath, [scriptPath, platform, arch], {
    stdio: 'inherit',
    windowsHide: true,
  });

  if (result.status !== 0) {
    throw new Error(`Failed to prepare packaged sharp runtime for ${platform}-${arch}.`);
  }
}

function prepareAcpRuntime(): void {
  const scriptPath = path.resolve(__dirname, 'scripts', 'prepare-acp-runtime.js');
  const result = spawnSync(process.execPath, [scriptPath], {
    stdio: 'inherit',
    windowsHide: true,
  });

  if (result.status !== 0) {
    throw new Error('Failed to prepare packaged chamber-copilot ACP runtime.');
  }
}

function prepareSqliteRuntime(): void {
  const scriptPath = path.resolve(__dirname, 'scripts', 'prepare-sqlite-runtime.js');
  const result = spawnSync(process.execPath, [scriptPath], {
    stdio: 'inherit',
    windowsHide: true,
  });

  if (result.status !== 0) {
    throw new Error('Failed to prepare packaged better-sqlite3 runtime.');
  }
}

function prepareMsalRuntime(): void {
  const scriptPath = path.resolve(__dirname, 'scripts', 'prepare-msal-runtime.js');
  const result = spawnSync(process.execPath, [scriptPath], {
    stdio: 'inherit',
    windowsHide: true,
  });

  if (result.status !== 0) {
    throw new Error('Failed to prepare packaged MSAL broker runtime.');
  }
}

// Issue #145 — the loopback server bundle ships as an Electron resource only
// when CHAMBER_MVP_SERVER=1 is set at package time. The runtime gate in
// apps/desktop/src/main.ts uses the same env variable to decide whether to
// spawn the server, so the two ends stay aligned. Default off saves ~MB of
// installer bytes for users who never exercise the MVP loopback path.
const includeMvpServerResource = process.env.CHAMBER_MVP_SERVER === '1';
const MVP_SERVER_RESOURCE = './apps/server/dist';

const baseExtraResource = [
  './resources/node',
  './resources/copilot-runtime',
  './resources/sharp-runtime',
  './resources/acp-runtime',
  './resources/msal-runtime',
  './resources/sqlite-runtime',
  './node_modules/keytar',
  './apps/desktop/src/main/assets/lens-skill',
];

const config: ForgeConfig = {
  packagerConfig: {
    asar: {
      unpack: '**/node_modules/{sharp,@img,@azure/msal-node-runtime}/**/*',
    },
    executableName: 'chamber',
    icon: APP_ICON_PATH,
    protocols: [
      {
        name: 'Chamber',
        schemes: ['chamber'],
      },
    ],
    extraResource: includeMvpServerResource
      ? [...baseExtraResource, MVP_SERVER_RESOURCE]
      : baseExtraResource,
  },
  publishers: [
    {
      name: '@electron-forge/publisher-github',
      config: {
        repository: {
          owner: 'ianphil',
          name: 'chamber',
        },
        prerelease: false,
        draft: false,
      },
    },
  ],
  rebuildConfig: {},
  hooks: {
    prePackage: async (_forgeConfig, platform, arch) => {
      prepareCopilotRuntime(platform, arch);
      prepareSharpRuntime(platform, arch);
      prepareAcpRuntime();
      prepareMsalRuntime();
      prepareSqliteRuntime();
    },
  },
  makers: [
    new MakerSquirrel({
      name: 'chamber',
      title: 'Chamber',
      setupIcon: WINDOWS_ICON_PATH,
    }),
    new MakerZIP({}, ['darwin', 'linux']),
    new MakerDeb({}),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'apps/desktop/src/main.ts',
          config: 'apps/desktop/vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'apps/desktop/src/preload.ts',
          config: 'apps/desktop/vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: PACKAGED_RENDERER_NAME,
          config: 'apps/web/vite.electron.config.ts',
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
