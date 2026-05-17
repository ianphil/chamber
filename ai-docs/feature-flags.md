# Feature Flags

Chamber feature flags are app-owned runtime decisions. They are not stored in
`~/.chamber/config.json`, and they are not user-configurable unless a future
feature explicitly needs that behavior.

## Current model

The shared flag contract lives in `packages/shared/src/feature-flags.ts`.
Desktop exposes the resolved flags through `window.electronAPI.app.getFeatureFlags()`,
and the renderer copies them into app state during startup.

Flags default to the safest stable behavior. Browser mode also returns the
default flags unless it grows its own deployment channel signal.

## Channel-derived flags

Use channel-derived flags for release-channel rollout decisions:

| Channel | Version shape | Switchboard Relay |
| ------- | ------------- | ----------------- |
| Stable | `X.Y.Z` | off |
| Insiders | `X.Y.Z-insiders.N` | on |

The resolver currently detects insiders builds from the embedded app version.
This matches the release-channel model in `ai-docs/release-channels.md`: the
runner mutates the version for the installer at build time, so the installed
insiders app sees an `-insiders.N` version even though `master` keeps the last
stable version on disk.

## Switchboard Relay

`switchboardRelay` gates the user-visible relay surface. When disabled, the
left activity bar hides the A2A Relay icon and direct navigation to the relay
view falls back to the default chat view. The lower-level A2A IPC/service
surface remains wired so internal agent-to-agent behavior is not coupled to the
preview UI toggle.

## Adding a flag

1. Add the flag to `AppFeatureFlags` and `DEFAULT_APP_FEATURE_FLAGS`.
2. Resolve it in `getAppFeatureFlags`.
3. Expose it only through `app:getFeatureFlags`; do not add it to user config.
4. Gate both the entry point and the target route/component when hiding a UI
   surface.
5. Add shared resolver tests and renderer tests for enabled and disabled states.
