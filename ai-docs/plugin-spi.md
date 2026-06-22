# Chamber Plugin SPI

Chamber ships a small Service Provider Interface (SPI) that lets a separate,
trusted package override Chamber's built-in first-run (Genesis) onboarding
without any plugin-specific code living in Chamber. Both seams default to a
no-op, so the base Chamber build is unchanged unless a plugin is configured.

The contract lives in `@chamber/plugin-api` (`packages/plugin-api`).

## The principle

> **Plugins are trusted, opt-in code. The SPI is an extension seam, not a sandbox.**

A plugin is loaded only when an operator configures it, and Chamber hands it a
deliberately narrow set of capabilities for the common case. That narrowness is
an ergonomic default and an audit aid, not containment: a plugin runs as trusted
code (see [Trust model](#trust-model)).

## The two seams

| Seam | When | Selected by | Default |
|------|------|-------------|---------|
| **Renderer** | Build time | `CHAMBER_PLUGIN_RENDERER` env var (resolved by the `virtual:chamber-plugin` Vite module) | no-op plugin |
| **Main** | Runtime | `chamberPlugin` config field, or the `CHAMBER_PLUGIN` env var | not loaded |

### Renderer seam

`apps/web/vite/chamberPluginVirtualModule.ts` serves the `virtual:chamber-plugin`
module. With nothing configured it resolves to `{ id: 'chamber-noop' }`. When
`CHAMBER_PLUGIN_RENDERER` names an entry, the virtual module re-exports that
entry's default export. `GenesisGate` then renders `plugin.onboarding ?? GenesisFlow`,
so a plugin's onboarding component fully replaces the built-in flow while mounted.

### Main seam

The composition root (`apps/desktop/src/main.ts`) constructs `PluginHost` and
loads `config.chamberPlugin ?? process.env.CHAMBER_PLUGIN` after Chamber's own
services and IPC are wired. `PluginHost` validates the module shape, calls
`registerMain(context)` exactly once, and logs-and-swallows every failure, so a
broken or missing plugin never blocks boot.

## Capabilities

A renderer plugin's onboarding component receives `OnboardingProps`. Chamber
owns the Electron access behind each capability; the plugin describes intent.

- `onComplete()` -- dismiss the onboarding gate and reveal the main app.
- `createMind(request)` -- install a marketplace template, optionally seed a
  document, and select the new mind as active. See the contract below.
- `serveOnboardingCanvas?(html)` -- serve plugin HTML over Chamber's loopback
  canvas server and return a URL for a sandboxed iframe. Unlike the plugin
  itself, this served HTML is genuinely isolated: it runs at a separate origin
  and cannot reach the renderer's globals or Chamber's privileged APIs.

A main plugin receives `MainPluginContext`: `appVersion`, `userDataPath`, and a
scoped `log(level, message, ...args)`.

### `createMind` result contract

`createMind` treats mind creation as the atomic deliverable and document seeding
as best-effort enrichment:

- `{ success: true, mindId }` -- the mind was created and selected.
- `{ success: true, mindId, seedError }` -- the mind was created and selected,
  but the optional document failed to seed. Non-fatal: the mind is usable; the
  surface may warn the user and still call `onComplete()`.
- `{ success: false, error }` -- no mind was created. The gate stays open.

The seed document is written to a fixed, Chamber-owned path
(`.chamber/onboarding.md`) inside the mind. Chamber writes it but never reads it
back; a plugin's own template or agent is responsible for consuming it. The
caller supplies only content, so there is no path-traversal surface.

## Trust model

The SPI is a trusted-plugin model. The real controls are:

1. **Opt-in loading.** Nothing loads unless an operator sets `CHAMBER_PLUGIN_RENDERER`,
   `chamberPlugin`, or `CHAMBER_PLUGIN`.
2. **A default-narrow handoff.** Chamber hands the plugin a small context, not
   raw Electron, for the common case.

What the SPI does **not** do is sandbox the plugin:

- A renderer plugin is bundled into the renderer, shares its globals, and can
  reach `window.electronAPI` directly.
- A main plugin is dynamic-imported with Chamber's full main-process privileges
  and can reach Node and Electron on its own.

Only treat packages you trust as plugins. The genuinely enforced boundaries
elsewhere in Chamber (the chatroom `ApprovalGate`, the Electron sandbox flags,
and the seed-document path validation) are unchanged by the SPI.

## Consumption model

`@chamber/plugin-api` is a workspace-internal contract: `private: true`, types
only, exported as raw source (matching `@chamber/shared` and `@chamber/client`).
It is consumed in source by Chamber and by trusted plugin packages built within
the Chamber workspace. It is **not** published to npm; a plugin package resolves
it as a workspace sibling at build time.

## Authoring a plugin

### A renderer onboarding plugin

```ts
import { defineRendererPlugin, type OnboardingProps } from '@chamber/plugin-api';

function MyOnboarding({ onComplete, createMind }: OnboardingProps) {
  // Render your own first-run experience. When ready, install a template
  // (optionally seeding a document) and then dismiss the gate.
  async function finish() {
    const result = await createMind({
      templateId: 'my-template',
      seedDocument: '# Welcome\n\n...',
    });
    if (result.seedError) {
      // Non-fatal: the mind exists; surface a warning if you like.
    }
    if (result.success) onComplete();
  }
  return null; // your UI calls finish()
}

export default defineRendererPlugin({ id: 'my-onboarding', onboarding: MyOnboarding });
```

Point Chamber at it at build time:

```sh
CHAMBER_PLUGIN_RENDERER=@my-scope/my-plugin/renderer
```

### A main-process plugin

```ts
import { defineMainPlugin } from '@chamber/plugin-api';

export default defineMainPlugin({
  id: 'my-main-plugin',
  registerMain(context) {
    context.log('info', `loaded into Chamber ${context.appVersion}`);
    // Wire up trusted main-process behavior here.
  },
});
```

Point Chamber at it via config or env:

```sh
CHAMBER_PLUGIN=@my-scope/my-plugin/main
# or an absolute path: CHAMBER_PLUGIN=C:\path\to\plugin\main.js
```
