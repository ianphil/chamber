# Chamber Insiders

Chamber Insiders is the fast-cadence prerelease channel. Builds ship sooner than the public stable releases on GitHub Releases. **This page is invitation-only**: it is not linked from the README or product website. If someone forwarded you the link, that's the invitation.

Insiders ships signed Windows and notarized macOS arm64 builds. Linux x64
ZIP and DEB packages are available as an early preview with manual updates.

## What you're trusting

Insiders installers come from a private Azure Blob container, are code-signed with the same Azure Trusted Signing certificate as stable releases, and are auto-updated from the same blob. The only differences from stable are:

- Faster cadence (often multiple builds per week vs. weekly stable).
- Less manual QA. Bugs are more likely.
- Prerelease version numbers (`vX.Y.Z-insiders.N`). The base `X.Y.Z`
  previews the **next stable** — so `v0.63.0-insiders.3` is the third
  preview of the upcoming `v0.63.0`. When stable ships, the
  corresponding insider tag and the stable tag point at the same source
  commit.
- Not advertised, not listed on GitHub Releases.

If you would like to be removed from the invite list, tell whoever invited you. The download URL itself is unlisted.

## Install

1. Download the artifact for your platform:

   ```
   https://chamberinsiders.blob.core.windows.net/releases/Chamber-Setup-latest-insiders.exe
   ```

   Linux artifacts use the versioned names
   `Chamber-linux-x64-<version>.zip` and
   `chamber_<version>_amd64.deb` under the same blob root. Use the ZIP
   on Arch and other non-Debian distributions.

2. Run the installer, or extract the Linux ZIP and launch `chamber`.
   SmartScreen should accept the Windows installer because it is signed
   with Chamber's Trusted Signing certificate.

3. Windows and macOS update automatically. Linux preview updates are
   downloaded manually.

## Updates

On Windows and macOS, Chamber Insiders checks the Azure Blob on a
regular cadence. When a newer `vX.Y.Z-insiders.N` is published, you
will get an in-app prompt to restart and update. Linux preview users
must download each new ZIP or DEB.

You will never see public stable releases on this channel. You also will never accidentally roll back from Insiders to stable: electron-updater refuses to downgrade.

## Switching back to stable

Insiders is a one-way switch by URL. To return to the public stable channel:

1. Download the latest public installer from <https://github.com/ianphil/chamber/releases>.
2. Run it. It installs over your Insiders install.
3. From then on, auto-updates come from GitHub Releases (`latest.yml`), not the Insiders blob.

You will remain on the version you have installed until the public stable channel catches up; electron-updater won't downgrade. That's intentional — feature parity with stable is the gate, not the version string.

## Caveats

- The download URL is unlisted, not access-controlled. Anyone with the URL can fetch.
- Linux preview artifacts are unsigned, omit the unsupported voice and
  WTD runtimes, and do not auto-update.
- There is no SLA. Insiders builds may regress, break auto-update, or be pulled without notice.

## Reporting issues

Use the same GitHub issues tracker as everyone else. Please prefix the issue title with `[insiders]` and include the exact `vX.Y.Z-insiders.N` version from `Help → About`.
