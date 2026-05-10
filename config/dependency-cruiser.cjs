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
      name: 'hono-stays-in-server-adapter',
      severity: 'error',
      from: { path: '^(apps/server|packages)' },
      to: { path: '^hono' },
      comment: 'Only apps/server/src/honoAdapter.ts may import Hono; enforce this with focused lint once apps/server exists.',
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: {
      path: '(^node_modules|^dist|^out|^\\.vite|^coverage)',
    },
    tsConfig: {
      fileName: 'tsconfig.json',
    },
  },
};
