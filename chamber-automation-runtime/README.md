# chamber-automation-runtime

Pinned packaged runtime for the Chamber automation script subsystem.

Ships `tsx` + `typescript` so cron-scheduled `.chamber/automation/*.ts` scripts
can run under the bundled Node runtime (`resources/node/bin/node`) without
relying on the user's system installation.

This folder is materialized into `resources/automation-runtime/` at package
time by `scripts/prepare-automation-runtime.js` (invoked by Forge's
`prePackage` hook). The whole folder ships as an Electron extraResource.

Do not bump `tsx` or `typescript` without coordinated CHANGELOG entry,
`smoke:automation` run, and `make:sandbox` validation.
