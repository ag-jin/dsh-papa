# `@deepseek-ai/dsh-desktop`

English | [中文](README.zh.md)

The Electron macOS launcher hosts the DSH desktop composition for a local developer without starting a DSH TCP or UDP listener.

## Runtime

The process entry installs `InvariantRegistry` before Loader entries mount, resolves bare base and `dsh-desktop-app` patch entry names through `createRequire(package.json)` to absolute modules, then boots those layers over its empty bundled root configuration, adds the package-owned `standard` agent-preset root as a system root, and starts `DesktopRuntimeSupervisor`.

The package declares the base and desktop patch dependency union, direct bootstrap providers, and every package named by its shipped agent presets at the application root. Staging recursively materializes their production dependencies and required peers, so Loader and the preset roster can resolve every configured entry from the packaged runtime.

The app serves the packaged renderer only through `dsh-app://renderer/...` and active catalog bundles only through `dsh-client://bundle/<id>?rev=<rev>`.

The protocol handler realpaths every renderer path, rejects containment escapes, and resolves every client bundle through `ClientBundleCatalog`.

## Renderer Privileges

Each BrowserWindow has context isolation, a sandboxed renderer, disabled Node integration, web security, and a response Content Security Policy with no network connections. It permits only local bootstrap scripts, catalog-authorized client bundles, and packaged font data.

The preload is one bundled CommonJS sandbox script. It exposes `window.__DSH_DESKTOP__` with fixed JSON-only `request`, `cancel`, `subscribe`, `sendCommand`, `getWindowState`, and `setWindowState` operations.

The Electron main process registers exactly five renderer-to-main handlers: request, cancel, command, window-state read, and window-state write; every handler first validates the attached sender window identity. State reads return normalized bounds, panel visibility and widths, and active workspace/session identifiers; writes accept a partial update and preserve other desktop-owned values.

## Desktop State

Electron user data stores only normalized window bounds, panel visibility and widths, and active workspace/session identifiers.

DSH remains the owner of credentials, transcripts, sessions, tool results, settings, and background jobs.

## Development

Run `pnpm --filter @deepseek-ai/dsh-desktop run build` to compile the Electron main entry and bundle the sandbox-compatible CommonJS preload against built workspace package declarations.

Run `pnpm --filter @deepseek-ai/dsh-desktop test` for the focused Electron protocol, preload, boot, and state unit tests.

Run `node node_modules/vitest/vitest.mjs run --config vitest.e2e.config.ts apps/desktop/tests/assembled-transport.e2e.ts` after the runtime, renderer, and desktop entries are built to verify the assembled Electron bridge.

Run `node node_modules/vitest/vitest.mjs run --config vitest.e2e.config.ts apps/desktop/tests/packaged-app-smoke.e2e.ts` after `desktop:package:mac` to launch the actual application bundle and verify its packaged renderer, fixed preload bridge, and embedded session request. The smoke test adds a temporary loopback Chromium CDP endpoint only for test attachment; the DSH runtime still opens no listener.

A runnable packaged window also requires the repository renderer build output under `apps/web/dist`.

## macOS Packaging

Run `pnpm run desktop:package:mac` on an Apple-silicon Mac running macOS 14 or later to create `apps/desktop/out/DSH-darwin-arm64/DSH.app`.

Run `pnpm run desktop:make:mac` to recreate that application and create `apps/desktop/out/DSH-<version>-arm64.dmg`.

The package uses an ad-hoc Electron signature. It has no Developer ID signature or notarization, so macOS may require Control-clicking the application or disk image and choosing Open on a different Mac.

The hardened-runtime signature grants the Electron main process and its Helper app bundles the entitlements needed to load the bundled Electron Framework; the Plugin Helper additionally retains its executable-memory entitlement.

The `Build macOS desktop app` GitHub Actions workflow runs this same command on `macos-14` and retains the application and disk image as an Actions artifact. It does not use Apple credentials or create a GitHub Release.

## Model Experience

This package does not add model-visible prompts, tools, or session events.

It carries existing DSH JSON RPC envelopes between the packaged renderer and the embedded runtime; model-visible behavior remains owned by the composed DSH plugins and the selected agent preset.
