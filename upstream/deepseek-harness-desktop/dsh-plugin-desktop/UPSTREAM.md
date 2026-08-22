# Anywhere Labs DSH Desktop Reference

This directory records the reviewed upstream release of `anywhere-labs/deepseek-harness-desktop` for comparison. It is not a pnpm workspace, does not participate in the DSH desktop composition, and is never staged into a desktop application artifact.

## Reviewed release

- Source: <https://github.com/anywhere-labs/deepseek-harness-desktop>
- Tag: `v2.0.1`
- Commit: `34c8f4b9bf90faaac82deb65661fccbc9d819a0e`
- License SHA-256: `ae36246eca21ae16838d566147ab356fd79bdf9ae1c2aa53349700e083f2d679`
- License: MIT; see [LICENSE](LICENSE).
- Reviewed on: 2026-08-22

The intended GitHub Fork is `ag-jin/dsh-plugin-desktop`. The public upstream remote is named `upstream-desktop` in this repository. Creating the Fork requires GitHub authentication and is separate from this tracked provenance record.

## Scope

The upstream release contains a Yarn root, an embedded Harness checkout, a loopback HTTP/WebSocket carrier, update services, branding assets, and dependencies pinned to DSH rc.7. None are imported into this repository or its desktop runtime. DSH uses the listener-free main-process runtime, typed preload bridge, current workspace dependencies, and artifact-only packaging documented in `apps/desktop`.

This directory keeps only upstream attribution and the verified release identity. It deliberately contains no executable upstream source, package manifest, dependency lockfile, updater, transport, or branding asset.

## Review and sync

Review every upstream update in a temporary clone before changing this record:

```sh
worktree=$(mktemp -d)
git clone https://github.com/anywhere-labs/deepseek-harness-desktop.git "$worktree"
git -C "$worktree" fetch --tags
git -C "$worktree" checkout --detach <reviewed-tag-or-commit>
git -C "$worktree" rev-parse HEAD
git -C "$worktree" subtree split --prefix=dsh-plugin-desktop
```

Compare the selected upstream tree with the current DSH implementation. A future source import requires a separate approved design that excludes the upstream loopback transport, update services, branding assets, embedded Harness checkout, and rc.7 dependency manifests. Update this file's tag, commit, review date, and preserved license only after that review.
