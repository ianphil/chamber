# Local Desktop Auto-Update Test

Use this runbook to manually click through Chamber's Windows desktop auto-update flow with a local generic update feed.

This verifies the user-visible `electron-updater` path: update check, download, restart/install, relaunch, and final installed version. It does not validate GitHub release publishing or Azure Trusted Signing.

## Prerequisites

- Windows.
- Python available as `python`.
- A clean worktree, or at least no uncommitted changes in `package.json` and `package-lock.json`.
- Dependencies already installed with `npm install`.

## Build the older installer with a local feed URL

From the repository root:

```powershell
$env:CHAMBER_BUILDER_UPDATE_URL = 'http://127.0.0.1:38033/'
npm run make
Remove-Item Env:\CHAMBER_BUILDER_UPDATE_URL

Remove-Item -Recurse -Force out\builder-old -ErrorAction SilentlyContinue
Copy-Item -Recurse out\builder out\builder-old
```

The important detail is that this older installer must contain `resources\app-update.yml` pointing at the local feed URL.

## Build the newer feed artifacts

Bump the package version temporarily, build the feed artifacts, then restore the source version:

```powershell
npm version patch --no-git-tag-version
npm run make

Remove-Item -Recurse -Force out\builder-feed -ErrorAction SilentlyContinue
Copy-Item -Recurse out\builder out\builder-feed

git restore package.json package-lock.json
```

The feed folder must contain the generated installer, blockmap, and `latest.yml`. Do not edit `latest.yml` by hand because its hashes and sizes must match the installer bytes.

## Install the older local-feed build

```powershell
$oldInstaller = Get-ChildItem out\builder-old -Filter 'Chamber-*-x64.exe' |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

Start-Process -Wait -FilePath $oldInstaller.FullName -ArgumentList '/S'
```

Confirm the installed app is the older version:

```powershell
(Get-Item "$env:LOCALAPPDATA\Programs\chamber\chamber.exe").VersionInfo.ProductVersion
```

## Serve the newer update feed

Keep this command running in its own terminal:

```powershell
python -m http.server 38033 --bind 127.0.0.1 --directory out\builder-feed
```

In another terminal, confirm the manifest is reachable and advertises the newer version:

```powershell
curl.exe -s http://127.0.0.1:38033/latest.yml
```

## Click through the update flow

Launch the installed app:

```powershell
& "$env:LOCALAPPDATA\Programs\chamber\chamber.exe"
```

In the app, use the update indicator in the activity bar footer near Settings:

1. Wait about 15 seconds if the indicator does not update immediately; the startup check is intentionally delayed.
2. Click the indicator to download the available update.
3. Wait for the download to complete.
4. Click the indicator again to restart and install.
5. The window should disappear while the installer runs, then relaunch into Chamber.

A brief black window during relaunch is acceptable if the app finishes loading into the landing screen or chat.

## Verify the result

After relaunch, confirm the installed executable version is the newer feed version:

```powershell
(Get-Item "$env:LOCALAPPDATA\Programs\chamber\chamber.exe").VersionInfo.ProductVersion
```

Check uninstall entries if you need to confirm installer registration:

```powershell
$entries = foreach ($root in @(
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
  'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
  'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
)) {
  if (Test-Path $root) {
    Get-ChildItem $root -ErrorAction SilentlyContinue |
      ForEach-Object { Get-ItemProperty $_.PSPath } |
      Where-Object { $_.DisplayName -like '*Chamber*' } |
      ForEach-Object {
        [ordered]@{
          DisplayName = $_.DisplayName
          DisplayVersion = $_.DisplayVersion
          InstallLocation = $_.InstallLocation
          UninstallString = $_.UninstallString
        }
      }
  }
}
@($entries) | ConvertTo-Json -Depth 4
```

## Cleanup

Stop the Python feed server with `Ctrl+C` in the terminal where it is running.

If you want to return to an official release build, uninstall the local NSIS build from Windows Apps & Features, then install the desired Chamber release installer.

## Troubleshooting

- If no update appears, verify the installed app's `resources\app-update.yml` points to `http://127.0.0.1:38033/`.
- If the manifest is unreachable, restart the Python feed server and re-run the `curl.exe` check.
- If the download falls back from differential to full download, that is expected with Python's simple HTTP server.
- If the app stays on a black screen after relaunch, close and reopen Chamber once before treating the update as failed.
