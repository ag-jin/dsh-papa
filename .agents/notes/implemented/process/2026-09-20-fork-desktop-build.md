# Agent Note: Package fork desktop builds without signing or an update feed

Status: implemented

English | [中文](2026-09-20-fork-desktop-build.zh.md)

## Problem

Desktop packaging enforces the official deployment: macOS requires a Developer ID identity, one notarization strategy, and a readable p12, and every platform requires a mandatory-update policy origin. A fork has no Apple certificate and no release deployment, so it cannot produce any macOS artifact, and `--unsigned` is rejected outside `win-x64`. Building with the official origin instead publishes a feed that would replace the fork's installation with official builds.

## Decision

`DSH_DESKTOP_FORK=1` in the target dotenv file selects a build that signs nothing, installs no update feed, and bakes no mandatory-update policy. The switch is a shared release setting: it is accepted in the dotenv file, and it is stripped from the ambient environment like every other release setting, so only the target file selects it.

[desktop-package-environment.mjs](../../../../apps/desktop/scripts/desktop-package-environment.mjs) exports `isForkDesktopBuild` and returns from validation after the application id, skipping the policy origin, the update origin, the Apple signing and notarization checks, `CSC_LINK`/`CSC_KEY_PASSWORD`, and the Windows certificate and SignTool checks. [package-target.ts](../../../../apps/desktop/scripts/package-target.ts) forces `unsigned` for the fork, which on macOS bypasses the signing keychain and the two artifact lanes that notarize, staple, and verify an App copy and a DMG. [electron-builder-config.mjs](../../../../apps/desktop/scripts/electron-builder-config.mjs) accepts an unsigned target off Windows only for the fork, turns off `mac.forceCodeSigning`, `mac.hardenedRuntime`, `mac.notarize`, and `dmg.sign`, skips signature verification and disk-image notarization in its hooks, and omits `dshMandatoryUpdatePolicy` from the packaged manifest. [prepare-dsh.ts](../../../../apps/desktop/scripts/prepare-dsh.ts) skips signing the dsh and primary-runtime trees.

The packaged application therefore starts with no policy service, because `resolveDesktopPolicyConfig(undefined)` returns `undefined`, and with no updater, because `publish: null` leaves electron-builder without an `app-update.yml` and the runtime enables updates only when that file exists. Artifacts land in `apps/desktop/.desktop-build/targets/<target>/unsigned-artifacts/`.

[desktop-package.yml](../../../../.github/workflows/desktop-package.yml) builds all three targets through this switch and publishes them to this repository's own releases: a `v*` tag publishes a stable release, and a manual dispatch refreshes the rolling `preview` prerelease. Each job writes the target dotenv file from the workflow environment, so the pipeline needs no signing secret.

## Alternatives considered

- Extend `--unsigned` to macOS without a separate switch. Rejected: it would let a release-shaped invocation produce an unqualified artifact, and the fork decision also has to turn off the feed and the policy, which signing alone does not cover.
- Relax the origin validators so GitHub release URLs can serve as the update origin. Rejected: the validators require a bare HTTPS origin, and an unsigned build still cannot update itself.
- Disable the updater and the policy in the runtime instead of at build time. Rejected: absent baked configuration already yields both behaviors, so runtime branches would add a second source of truth.

## Consequences

An unsigned artifact cannot update itself: macOS Squirrel requires signed updates, and the build carries no feed, so moving versions means replacing the installation. macOS quarantines an application downloaded from the internet until the user clears the attribute once. Fork builds keep no release completion record, so they cannot use the `upload:*` commands.

Full arm64 packaging was run on the fork switch: the target produced its DMG and ZIP, the log contains no signing or notarization step, the packaged manifest carries no policy field and no `app-update.yml`, and the packaged application started with its Host.

## Testing

`apps/desktop/tests/desktop-package-environment.spec.ts` covers the fork validation path, the malformed flag, and ambient stripping; `apps/desktop/tests/macos-signature.spec.ts` covers the fork electron-builder configuration and keeps rejecting an unsigned non-fork macOS build.
