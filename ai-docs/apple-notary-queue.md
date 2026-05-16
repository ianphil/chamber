# Checking the Apple Notary Queue

A short runbook for inspecting Chamber's macOS notarization submissions
via Apple's `notarytool`. Use this when:

- A stable release is stuck on the macOS leg.
- You want to know whether the team's first-time "in-depth analysis"
  warmup is complete (i.e. whether new submissions clear quickly).
- You're about to dispatch a stable release and want to confirm it
  won't stall.

## Prerequisites

You need three Apple credentials:

- `APPLE_ID` — the Apple ID associated with the Developer Program
  membership (an email address).
- `APPLE_APP_SPECIFIC_PASSWORD` — an app-specific password generated at
  <https://appleid.apple.com> → Sign-In and Security → App-Specific
  Passwords. **Not** the Apple ID password itself.
- `APPLE_TEAM_ID` — Chamber's is `9LH8H98USP`.

Locally these live in a gitignored `.env` at the repo root. In CI they
are GitHub secrets (`secrets.APPLE_ID`, `secrets.APPLE_ID_PASSWORD`,
`secrets.APPLE_TEAM_ID`).

To use them in a shell session:

```bash
set -a; source .env; set +a
```

This is the same pattern the build scripts use.

## Quick health check

The fastest signal of warmup status:

```bash
xcrun notarytool history \
  --apple-id "$APPLE_ID" \
  --team-id "$APPLE_TEAM_ID" \
  --password "$APPLE_APP_SPECIFIC_PASSWORD" \
  | head -30
```

Read the output as a column table. The relevant fields are
`createdDate`, `status`, and `id`.

| Status        | Meaning                                                                 |
| ------------- | ----------------------------------------------------------------------- |
| `Accepted`    | Notarized successfully. Done.                                           |
| `In Progress` | Still queued at Apple. No action available.                             |
| `Invalid`     | Apple rejected. Fetch the log (see below) to find out why.              |
| `Rejected`    | Same as Invalid; you need to fix something and resubmit.                |

### Warmup determination

Compare the gap between `createdDate` and what would be the completion
time for recent `Accepted` submissions:

- **Warmup not yet complete** — recent submissions show `Accepted`
  hours or days after `createdDate`, or several are still `In Progress`.
- **Warmup complete** — recent submissions show `Accepted` within a few
  minutes of `createdDate`. From this point forward, fresh submissions
  clear in <5 min.

Apple does **not** publish a ceiling for in-depth analysis. Per Apple
DTS, the typical range for a new Developer ID team is 1–2 days per
submission for the first ~5–10 submissions. Subsequent builds are
fingerprinted and clear quickly.

## Inspecting a specific submission

When `history` shows a submission you want to dig into:

```bash
xcrun notarytool info <submission-id> \
  --apple-id "$APPLE_ID" \
  --team-id "$APPLE_TEAM_ID" \
  --password "$APPLE_APP_SPECIFIC_PASSWORD"
```

Returns the same fields as `history` plus more detail.

## Fetching the failure log

For an `Invalid` submission, the log JSON contains the actual signing
or entitlement violation:

```bash
xcrun notarytool log <submission-id> \
  --apple-id "$APPLE_ID" \
  --team-id "$APPLE_TEAM_ID" \
  --password "$APPLE_APP_SPECIFIC_PASSWORD" \
  /tmp/notary-log.json

jq . /tmp/notary-log.json
```

Common issues:

- `The signature does not include a secure timestamp` — `--timestamp`
  missing from `codesign` invocation.
- `The executable does not have the hardened runtime enabled` —
  missing `--options runtime` in the signing pipeline.
- `The binary uses an SDK older than the 10.9 SDK` — typically a
  bundled dependency built against a very old SDK; check vendored
  binaries.

## Cancelling a submission

You can't. `notarytool` has no cancel API. If a submission is stuck
during warmup, it will complete on its own (eventually) and counts
toward warmup. A second submission while the first is still
`In Progress` is fine — they queue independently.

## Sanity check before dispatching stable

Before dispatching `release.yml` with macOS legs, run:

```bash
xcrun notarytool history \
  --apple-id "$APPLE_ID" \
  --team-id "$APPLE_TEAM_ID" \
  --password "$APPLE_APP_SPECIFIC_PASSWORD" \
  | head -10
```

Decision rule:

- All recent submissions `Accepted` within minutes → safe to dispatch
  stable.
- One or more recent submissions still `In Progress` after >1 hour →
  warmup likely incomplete. Insiders-only until clear.
- Mixed `Accepted` (quick) and older `In Progress` → warmup probably
  done, but the old ones may still stall a workflow at the
  `--wait --timeout 30m` ceiling. Consider raising the timeout for
  that one run, or wait until the queue is fully drained.

## Related

- [`release-channels.md`](./release-channels.md) — the broader release
  flow that depends on notarization completing.
- `scripts/notarize-macos-prepackaged.js` — the script that invokes
  `notarytool submit` during a build.
- `.github/workflows/release.yml` — the workflow that runs notarization
  in CI; uses the secrets versions of the credentials.
