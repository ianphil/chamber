# Edge Marketplace Install Link Smoke

Use this runbook to validate the real README badge flow for an internal Genesis marketplace:

1. Edge opens the internal `agency-microsoft/genesis-minds` repository using your signed-in browser session.
2. The README `Add to Chamber` badge is clicked.
3. Edge hands off the `chamber://install?registry=...` URL to the installed Chamber app.
4. Chamber prompts to add the marketplace.
5. After approval, Chamber persists `agency-microsoft/genesis-minds` as an enabled Genesis marketplace.

This smoke intentionally crosses outside the hermetic Playwright Electron test harness. It uses your running Edge browser via the Playwright MCP Bridge extension and an installed Chamber build so Windows protocol registration is exercised.

## Prerequisites

- Windows with Microsoft Edge.
- Edge is signed into GitHub with access to `https://github.com/agency-microsoft/genesis-minds`.
- The Playwright MCP Bridge extension is installed and connected in Edge.
- `playwright-cli` is available on `PATH`.
- A local ignored `.env` file at the Chamber repo root contains:

  ```powershell
  PLAYWRIGHT_MCP_EXTENSION_TOKEN=<extension token>
  ```

- `.env` and `.playwright-cli/` are ignored by Git.
- Chamber is built and installed from the branch under test so the `chamber` protocol is registered.
- The internal marketplace README contains the badge:

  ```markdown
  [![Add to Chamber](https://img.shields.io/badge/Add%20to-Chamber-7c3aed)](https://chmbr.dev/install.html?registry=https%3A%2F%2Fgithub.com%2Fagency-microsoft%2Fgenesis-minds)
  ```

## Build and install Chamber

From the Chamber repo root:

```powershell
git switch feat/marketplace-install-links-172
npm run make
```

Install the newest generated NSIS installer from `out\builder`.

Confirm protocol registration:

```powershell
Test-Path HKCU:\Software\Classes\chamber
Test-Path HKLM:\Software\Classes\chamber
```

At least one command should return `True`.

## Run the smoke

Load the local token and enable the gated test:

```powershell
Get-Content .env | ForEach-Object {
  if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
    [System.Environment]::SetEnvironmentVariable($Matches[1].Trim(), $Matches[2].Trim(), 'Process')
  }
}

$env:CHAMBER_E2E_EDGE_MARKETPLACE_INSTALL_LINK = '1'
npm run smoke:desktop -- tests/e2e/electron/marketplace-install-link-edge.spec.ts
Remove-Item Env:\CHAMBER_E2E_EDGE_MARKETPLACE_INSTALL_LINK
```

For demos, add a pause between each browser handoff step:

```powershell
$env:CHAMBER_E2E_EDGE_MARKETPLACE_INSTALL_LINK = '1'
$env:CHAMBER_E2E_EDGE_MARKETPLACE_INSTALL_LINK_SLOW_MS = '5000'
npm run smoke:desktop -- tests/e2e/electron/marketplace-install-link-edge.spec.ts
Remove-Item Env:\CHAMBER_E2E_EDGE_MARKETPLACE_INSTALL_LINK
Remove-Item Env:\CHAMBER_E2E_EDGE_MARKETPLACE_INSTALL_LINK_SLOW_MS
```

The test connects to the running Edge browser with:

```powershell
playwright-cli config --extension --browser=msedge
```

It then opens the internal repo, snapshots the page, finds the `Add to Chamber` badge, clicks it, follows the GitHub Pages interstitial to `chamber://`, and waits for Chamber's persisted config to include `github:agency-microsoft/genesis-minds`.

## During the test

Depending on local Edge and Windows settings, you may need to approve prompts:

1. Edge external protocol prompt for `chamber://`.
2. Chamber confirmation dialog: `Add this Genesis marketplace to Chamber?`

Accept both. The test polls the Chamber config after the click and passes when the internal marketplace is present and enabled.

## Cleanup

The smoke backs up `~\.chamber\config.json` before clicking the badge and restores it afterward. If a run is interrupted, restore the config manually from the path printed in the Playwright output or remove the internal marketplace from Settings.

Stop the Playwright CLI session when finished:

```powershell
playwright-cli session-stop
```

## Troubleshooting

- **`PLAYWRIGHT_MCP_EXTENSION_TOKEN is not set`** - load `.env` into the current PowerShell process.
- **`playwright-cli was not found`** - install or expose the CLI on `PATH` before running the gated smoke.
- **`The chamber protocol is not registered`** - install the packaged Chamber build from this branch and re-check the registry keys.
- **Internal repo opens a 404 or sign-in page** - sign into Edge with an account that can access `agency-microsoft/genesis-minds`.
- **Badge not found** - refresh the internal repo page and confirm the README includes the `Add to Chamber` badge.
- **Smoke times out after clicking the badge** - check whether Edge or Chamber is waiting for a manual approval prompt.
