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

const enableMacOSSigning = process.platform === 'darwin' && process.env.ENABLE_MACOS_SIGNING === 'true';
const enableMacOSNotarization =
  enableMacOSSigning &&
  Boolean(process.env.APPLE_ID) &&
  Boolean(process.env.APPLE_ID_PASSWORD) &&
  Boolean(process.env.APPLE_TEAM_ID);

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

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    executableName: 'chamber',
    extraResource: ['./resources/node', './resources/copilot-runtime', './apps/server/dist', './node_modules/keytar'],
    ...(enableMacOSSigning
      ? {
          osxSign: {},
          ...(enableMacOSNotarization
            ? {
                osxNotarize: {
                   
                  appleId: process.env.APPLE_ID!,
                   
                  appleIdPassword: process.env.APPLE_ID_PASSWORD!,
                   
                  teamId: process.env.APPLE_TEAM_ID!,
                },
              }
            : {}),
        }
      : {}),
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
    },
  },
  makers: [
    new MakerSquirrel({
      name: 'chamber',
      shortcutName: 'Chamber',
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
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'apps/desktop/src/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
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
