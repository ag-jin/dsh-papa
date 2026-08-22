# Agent Note: Desktop runtime owns embedded transport without a listener

Status: implemented

English | [中文](2026-08-17-desktop-runtime-no-listener.zh.md)

## Problem

The browser application reaches DSH through a Web server and browser-origin assumptions. A macOS desktop application needs the same API and client feature graph without binding a DSH TCP or UDP listener or granting the renderer ambient host capabilities.

## Decision

`@deepseek-ai/dsh-desktop-runtime` owns an application-scoped `DesktopRuntimeSupervisor` over the composed `ApiProxy`. It dispatches unary requests through `toFetchHandler(api)`, returns client-response receipts through `api.respond()`, and forwards the fixed `mux` and `host` event sources as full `ServerRequest` envelopes. Each attached renderer window owns an abort controller for both sources and all active unary requests; replacement and detach abort that ownership, while runtime stop waits for every active unary dispatch and pump to settle, whether fulfilled or rejected, or for the configured shutdown deadline before reporting `stopped`.

`@deepseek-ai/dsh-desktop-app` extends the base application by patch composition. It includes the client feature roster, API proxy, module registry, connection package, and desktop runtime while omitting browser server, static-resource, startup, runtime, HMR, and HTTP-origin-trust rows. `ClientModuleRegistry` and the connection core therefore treat `webServer` as optional: catalog and boot graph composition remain available to desktop protocol handlers, while browser routes, index injection, `/api`, and WebSocket downlinks exist only when the service is composed. The desktop patch selects the native directory-picker provider directly rather than the bind-host auto selector, registers a bundle-level invariant that rejects `webServer`, and disables base model-facing rows in favor of the `standard` agent preset per desktop session.

`apps/desktop` installs `InvariantRegistry` during app-boot preparation, resolves bare base and desktop patch entry names through `createRequire(package.json)` to absolute modules, then boots those patch files over an empty bundled root and adds its shipped `standard` preset directory as a system root. It declares the base and desktop patch dependency union plus direct bootstrap providers at its application root so this resolution can complete before Loader imports an entry. Its Electron process registers privileged `dsh-app` and `dsh-client` schemes before readiness, serves renderer files only after realpath containment checks, injects the active catalog boot graph into renderer HTML, and resolves bundle assets only through `ClientBundleCatalog`. The main process gives every window a sandboxed, context-isolated renderer with Node integration disabled and one bundled CommonJS preload bridge. The response CSP keeps `connect-src 'none'` while permitting the injected local bootstrap scripts, authorized client bundles, Loader expression evaluation, and packaged data fonts. Its five IPC handlers bind the Electron sender id to `DesktopBridgeAuthority`; Electron-local state contains only bounded desktop view preferences and window geometry, and partial renderer updates merge with the current normalized state. The ad-hoc hardened-runtime signature grants the main process and non-Plugin Helper app bundles JIT plus library-validation exceptions; the Plugin Helper receives its required executable-memory and library-validation exceptions instead.

## Alternatives considered

**Reuse the browser Web server.** This would preserve existing resource URLs but turns desktop startup into a local network service, retains origin-trust rules, and leaves another listener lifecycle to secure and test.

**Expose generic Electron IPC or filesystem calls.** This would make renderer integrations easy to add but gives untrusted renderer code ambient main-process authority. The runtime accepts only typed RPC envelopes, fixed downlink kinds, fixed cancellation ids, and window-bound operations.

**Duplicate the client module graph for desktop.** This would split bundle revisions and path validation between browser and desktop. The shared catalog remains the single authority for active client bundles.

## Consequences

Desktop callers use the same API request and stream semantics as browser callers without a DSH listener. The Electron main process owns packaged resource delivery, per-window bridge attachment, response CSP, and desktop-local view state, while browser-only serving remains outside the desktop patch.

## Verification

The runtime package verifies unary dispatch, receipts, cancellation, malformed bridge input, per-window stream abort, runtime invariants, real Cordis plugin mounting and disposal, package invariants, and the desktop patch resolver closure. The desktop app verifies protocol containment and catalog authorization, boot-manifest injection, preload allowlisting, window security options and CSP, fixed IPC registration, listener-free patch boot, normalized desktop-local state, per-Helper entitlement selection, and a real ad-hoc signed app through the packaged renderer, bridge, runtime request, and standard-preset session creation.
