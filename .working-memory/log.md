# Working Memory — Log

## 2026-04-10
- [auth] Packaged Chamber cannot rely on Vite externalization alone for `keytar`; the installed app needs `node_modules/keytar` bundled under `resources/` and loaded from `process.resourcesPath`.
- [packaging] `prepare-node-runtime.js` must stage and validate `resources/node` before swapping it into place; deleting the existing runtime first can strand Forge with a missing bundled Node folder.
- [installer] Squirrel upgrades can fail if another process, including VS Code, holds the previous `app-<version>/resources/app.asar` open inside `LocalAppData`.
