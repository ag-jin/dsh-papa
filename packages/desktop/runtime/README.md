# @deepseek-ai/dsh-desktop-runtime

English | [中文](README.zh.md)

The desktop runtime provides the Electron main process with an embedded DSH request path. It exposes a lifecycle supervisor, a fixed renderer bridge authority, and an ApiProxy adapter built from `toFetchHandler`. The adapter is in-process: it never binds a TCP or UDP listener and it does not create the Web server service.

## Lifecycle

`DesktopRuntimeSupervisor` starts from an explicit ApiProxy factory and reports `starting`, `ready`, `degraded`, `stopping`, or `stopped`. A failed start becomes `degraded` with its error text. Stop closes admission, aborts active client requests, detaches every window, and waits for the abort-signaled unary dispatches plus mux and host pumps to settle, whether fulfilled or rejected, or for the configured shutdown deadline before it reports `stopped`; repeated stop calls share the same completion promise.

The runtime tracks each active `client-request` by its renderer window and rpc id. The preload bridge communicates cancellation as that JSON-safe rpc id; the main process owns the corresponding `AbortController`. Unknown or finished request ids are benign for an attached window.

## Bridge Authority

`DesktopBridgeAuthority` accepts only attached main-process window identities and two fixed operations: request and cancellation. It validates both existing RPC carrier forms with the ApiProxy schemas: `ClientRequest` returns `ServerResponse`, and `ClientResponse` returns `RpcReceipt`. It exposes no generic IPC operation, filesystem operation, shell operation, or Electron object to the renderer.

## Model Experience

### Embedded transport

#### What the model sees

None. `DesktopRuntimeSupervisor` forwards existing API messages and lifecycle state without adding text, tools, or other content to a model request.

#### Token effect

None. The package does not assemble provider requests or change their token content.

#### KV Cache effect

None. The package does not alter model-visible request prefixes.

## Known Limitations and Deferred Work

- **Electron presentation** — Electron window construction, preload registration, desktop protocol serving, UI controls, recovery presentation, and macOS packaging belong to separate desktop layers.
