module.exports = {
  forbidden: [
    {
      name: 'no-electron-in-services',
      severity: 'error',
      from: { path: '^(packages/(services|shared|wire-contracts|client)|apps/(server|web))' },
      to: { path: '^electron$' },
    },
    {
      name: 'services-do-not-import-apps',
      severity: 'error',
      from: { path: '^packages/services' },
      to: { path: '^apps/' },
    },
    {
      name: 'wire-contracts-are-type-only-and-runtime-agnostic',
      severity: 'error',
      from: { path: '^packages/wire-contracts' },
      to: { path: '^(node:|electron$|apps/|packages/(client|services))' },
    },
    {
      name: 'hono-stays-in-web-adapters',
      severity: 'error',
      from: { path: '^(apps/(desktop|web)(/|$)|packages)' },
      to: { path: '^hono' },
      comment: 'Only apps/server owns Hono route adapters.',
    },
    {
      name: 'foundry-local-sdk-only-in-voice-workers',
      severity: 'error',
      from: { pathNot: '^apps/desktop/src/main/voiceWorker/voiceWorker\\.ts$' },
      to: { path: '^foundry-local-sdk' },
      comment: 'Foundry Local SDK is only loaded inside the voice worker threads. Renderer / services / shared must talk to it via the VoiceWorkerPool RPC.',
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: {
      path: '(^node_modules|(^|/)dist|^out|^\\.vite|^coverage)',
    },
    tsConfig: {
      fileName: 'tsconfig.json',
    },
  },
};
