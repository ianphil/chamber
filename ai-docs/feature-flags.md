# Feature Flags

Chamber feature flags are app-owned runtime decisions. They are not stored in
`~/.chamber/config.json`, and they are not user-configurable unless a future
feature explicitly needs that behavior.

## Current model

The shared flag contract lives in `packages/shared/src/feature-flags.ts`.
Desktop exposes the resolved flags through `window.electronAPI.app.getFeatureFlags()`,
and the renderer copies them into app state during startup.

Flags default to the safest stable behavior. Browser mode returns the default
flags unless it grows its own deployment channel signal. Desktop has three
explicit modes:

| Mode | Flag source | Behavior |
| ---- | ----------- | -------- |
| Stable packaged build | Embedded stable version, `X.Y.Z` | Preview flags off |
| Insiders packaged build | Embedded insiders version, `X.Y.Z-insiders.N` | Preview flags on |
| Local dev, `npm start` | `apps/desktop/src/main/devFeatureFlags.ts` | Independently toggleable |

The dev file is committed on purpose. It makes local preview behavior visible in
code review and avoids hidden per-developer environment setup.

## Release-channel flags

Use channel-derived flags for release-channel rollout decisions:

| Channel | Version shape | Switchboard Relay |
| ------- | ------------- | ----------------- |
| Stable | `X.Y.Z` | off |
| Insiders | `X.Y.Z-insiders.N` | on |

The same channel rule currently controls these preview surfaces:

| Flag | Stable | Insiders | Notes |
| ---- | ------ | -------- | ----- |
| `switchboardRelay` | off | on | Hides the activity-bar relay entry point and route. |
| `byoLlm` | off | on | Hides BYO model settings and disables desktop BYO runtime/IPC usage. |
| `chamberCopilot` | off | on | Wires the chamber-copilot ACP provider and `cli_*` tools. |

The resolver currently detects insiders builds from the embedded app version.
This matches the release-channel model in `ai-docs/release-channels.md`: the
runner mutates the version for the installer at build time, so the installed
insiders app sees an `-insiders.N` version even though `master` keeps the last
stable version on disk.

E2E specs that validate preview-only surfaces may opt in with
`CHAMBER_E2E=1 CHAMBER_E2E_PREVIEW_FEATURES=1`. Do not use that override for
normal app runs or release builds.

## Local development flags

For unpackaged Electron runs, Chamber uses `DEV_FEATURE_FLAGS` from
`apps/desktop/src/main/devFeatureFlags.ts`. Packaged builds ignore the file
entirely.

Change individual booleans there when local development needs a different
combination, for example testing stable-like behavior for only BYO LLM while
keeping Switchboard Relay enabled.

Default dev values currently keep all preview surfaces on:

```ts
export const DEV_FEATURE_FLAGS = {
  switchboardRelay: true,
  byoLlm: true,
  chamberCopilot: true,
};
```

## Switchboard Relay

`switchboardRelay` gates the user-visible relay surface. When disabled, the
left activity bar hides the A2A Relay icon and direct navigation to the relay
view falls back to the default chat view. The lower-level A2A IPC/service
surface remains wired so internal agent-to-agent behavior is not coupled to the
preview UI toggle.

## BYO LLM

`byoLlm` gates the local/custom model surface. When disabled, Settings hides
the "Local & Custom LLM" section, the desktop main process ignores any saved
BYO provider config, the BYO model-list side-channel returns no custom models,
and BYO IPC mutation/probe/restart handlers report that the feature is
unavailable in the current release channel.

Existing saved BYO credentials are not deleted when a stable build runs. They
are simply ignored until the user runs an insiders build again.

## chamber-copilot ACP

`chamberCopilot` gates the chamber-copilot ACP extension. When disabled,
`ChamberCopilotService` is not constructed and the `cli_*` tools are not added
to mind tool providers. Stable builds also ignore the legacy
`chamberCopilotEnabled` key in `~/.chamber/config.json`; users cannot turn this
surface on locally.

## Adding a new feature flag

Use this checklist when introducing a flag for a feature still under
development.

1. Add the flag to `AppFeatureFlags` and `DEFAULT_APP_FEATURE_FLAGS`.
2. Add a dev default in `apps/desktop/src/main/devFeatureFlags.ts`.
3. Decide whether insiders should get the feature immediately.
4. Resolve release behavior in `getAppFeatureFlags`.
5. Expose it only through `app:getFeatureFlags`; do not add it to user config.
6. Gate both the entry point and the target route/component when hiding a UI
   surface.
7. If disabling the UI is not enough, gate the runtime/service path too.
8. Add shared resolver tests and renderer tests for enabled and disabled states.
9. Update this document's current-flags table if the flag is expected to live
   longer than a one-off experiment.

### File map

| Purpose | File |
| ------- | ---- |
| Shared flag type and release resolver | `packages/shared/src/feature-flags.ts` |
| Shared resolver tests | `packages/shared/src/feature-flags.test.ts` |
| Dev-mode defaults | `apps/desktop/src/main/devFeatureFlags.ts` |
| Desktop IPC exposure | `apps/desktop/src/main.ts` via `app:getFeatureFlags` |
| Renderer state | `apps/web/src/renderer/lib/store/state.ts` |
| Renderer startup load | `apps/web/src/renderer/hooks/useAppSubscriptions.ts` |
| Browser-mode defaults | `apps/web/src/browserApi.ts` |

Most new flags only touch the shared type/resolver, the dev defaults, and the
feature-specific gates. The IPC and renderer-state plumbing should already
carry new fields because the flag object is passed as a whole.

### Release behavior decision

Before wiring the feature, choose one of these rollout shapes:

| Rollout shape | Stable | Insiders | Dev |
| ------------- | ------ | -------- | --- |
| Preview feature | off | on | controlled by `DEV_FEATURE_FLAGS` |
| Dev-only experiment | off | off | controlled by `DEV_FEATURE_FLAGS` |
| Stable feature | on | on | controlled by `DEV_FEATURE_FLAGS` until cleanup |

Most new work should start as a **dev-only experiment** until it is ready for
insiders. Flip the insiders value when the feature is safe enough for testers.
When a feature graduates to stable, remove the flag in a follow-up cleanup
instead of leaving dead conditionals around indefinitely.

### Gate depth

Pick the shallowest gate that is still honest:

| Feature kind | Required gates |
| ------------ | -------------- |
| Pure navigation or view preview | Hide the entry point and guard direct route rendering. |
| Settings surface | Hide the settings section and ignore saved settings if they should not apply. |
| Runtime capability | Do not construct/register the service or provider when disabled. |
| IPC/API mutation surface | Return an explicit unavailable error when disabled. |
| Data migration or background job | Gate the scheduler/runner, not just the UI that starts it. |

Do not rely on "the button is hidden" when background code, persisted config,
agent tools, IPC handlers, or scheduled work could still execute.

### Tests to add

Add tests at the same depth as the gate:

1. `packages/shared/src/feature-flags.test.ts` for stable, insiders, and dev
   override behavior.
2. Renderer component tests for hidden and visible states when the flag controls
   UI.
3. IPC/service tests for explicit disabled behavior when runtime calls must be
   unavailable.
4. E2E smoke updates only when an existing smoke needs preview features; use
   `CHAMBER_E2E=1 CHAMBER_E2E_PREVIEW_FEATURES=1` for that harness-only path.

### Do not

- Do not add normal feature flags to `~/.chamber/config.json`.
- Do not make preview flags user-configurable in Settings.
- Do not require developers to remember environment variables for `npm start`.
- Do not leave stable builds able to execute disabled runtime paths.
- Do not use a broad "preview" check directly in renderer components; consume
  named fields from `AppFeatureFlags` so every gate is searchable.
