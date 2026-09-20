# Design: Remote host connection over SSH

Status: proposed

English | [中文](2026-09-20-remote-host-connection-design.zh.md)

## Problem

Two client applications serve the DeepSeek Harness GUI: the Electron Desktop application and the browser Web GUI served by `dsh web`. Both drive exactly one Harness Host — the one they were served or launched from. A user who runs Harness on a second machine (a build box, a home server, a lab workstation) cannot reach that machine's Sessions or Workspaces from either client: they must open a browser tab against the remote machine directly, which means exposing the remote Web server to the network.

The remote Web server carries remote-code-execution-grade methods (`session.prompt` drives an agent that runs bash). Its shipped posture is therefore loopback-only: `packages/bundle/web-app/src/startup.ts` rejects `--host 0.0.0.0` outright, and the `/api` fence in `packages/client/connection/src/api-request-trust.ts` accepts a request only when its `Host` is loopback or a declared `trustedHosts` authority.

The goal is to reach a remote Harness's Sessions and Workspaces from either client, and to operate those remote Sessions exactly like local ones, without widening the remote machine's network exposure.

## Measured constraints

These were verified against a running `dsh web`, not inferred.

### The page origin and the API origin must agree

The `/api` fence compares the request's `Origin` against its `Host`:

```
const origin = header(request.headers, 'origin')
if (origin === undefined) return true
try {
  return new URL(origin).host === hostUrl.host
}
```

Measured against a local server on `127.0.0.1:3091`:

| Request `Origin` | Result |
|---|---|
| `http://127.0.0.1:3091` (same authority as `Host`) | 404 (routed; fence passed) |
| `http://127.0.0.1:9999` (different port) | 403 (fence refused) |

A page served from one origin therefore cannot call the API on another origin merely by pointing `fetch` at it. The naive design — keep the page on the local origin and redirect API calls to the tunnel port — is refused by the fence.

### A tunnel satisfies the fence when the page is served through it

A TCP forward was placed on `127.0.0.1:51080` in front of the server's `127.0.0.1:3091`, and the page was requested through the forward. Measured:

| Step | Result |
|---|---|
| `GET /?token=…` with `Host: 127.0.0.1:51080` | 303, `Set-Cookie: dsh-auth-…` |
| `POST /api` with that cookie and matching `Origin` | 404 (routed; fence and auth passed) |
| `POST /api` with no cookie | 401 |

The issued cookie's signed payload carries `"authority":"127.0.0.1:51080"` — the tunnel authority, not the server's real authority. This is the decisive fact: **the page must be loaded through the same authority the API is called on**, and the cookie is bound to that authority. A tunnel port that changes between runs invalidates the stored cookie.

### The server offers no cross-origin path at all

A cross-origin `POST /api` carrying a valid cookie was measured against the local server:

| Request | Result |
|---|---|
| Through the tunnel authority, matching `Origin` | 404 (routed; fence and auth passed) |
| Directly at the server's own port, foreign `Origin` | 403 (fence refused) |

The server sends no `Access-Control-Allow-*` header on any response, and an `OPTIONS` preflight is answered 403. A browser page therefore cannot call the API on an origin other than its own, and no header manipulation on the client can change that: the browser, not the page, composes `Origin`, and it withholds the response from the page when CORS does not authorize it.

### A browser page served through the tunnel is the working shape

Requesting the GUI itself through the tunnel was measured:

| Step | Result |
|---|---|
| `GET /?token=…` through the tunnel | 200, 27,660 bytes, carrying `<div id="root">` and the boot injection |
| `POST /api` through the tunnel with the exchanged cookie | 404 (routed; fence and auth passed) |
| `POST /api` through the tunnel with no cookie | 401 |

The remote's own GUI bundle, served through the tunnel, is fully functional: its page origin equals the API origin, so the fence, the cookie exchange, and CORS all agree without any client-side protocol work.

### The Desktop shell's own forwarding is shell-owned, not portable to a browser

`ClientTransportHooks` in `packages/client/connection/src/client/index.ts` lets a shell replace the transport (`fetch`, `openStream`, `streamBaseUrl`), and `apps/web/src/main.ts` writes it for the Desktop shell, which loads the page over the `dsh-app://` protocol while the API lives on `http://127.0.0.1:<port>`. `apps/desktop/src/main.ts` (~line 441) rewrites outbound `origin`, `cookie`, and `sec-fetch-site` so the fence sees a same-origin request.

That mechanism works only because Electron owns the network stack of its own window. A browser tab offers no equivalent hook. Even setting aside the fence, `Origin` and `sec-fetch-site` are browser-forbidden headers that page script cannot override, and the session cookie is `HttpOnly; SameSite=Strict` — so no amount of client-side base-URL plumbing makes a page call the API on another origin.

### An embedded frame does work, and was verified in a real browser

A local page on `127.0.0.1:51200` embedded the tunnel origin `127.0.0.1:51100` in an `iframe`, with the tunnel origin already authenticated. Measured in Microsoft Edge:

| Observation | Result |
|---|---|
| Frame rendered the remote GUI | Full sidebar, Workspaces, and composer visible |
| Remote plugin bundles requested | All `dsh-*` `client.js` rows served from the tunnel origin |
| Remote API calls | `/api/settings/describe`, `/api/credentials/describe`, `/api/session/modelCatalog` all answered |
| `X-Frame-Options` / `frame-ancestors` on the remote index | Absent; embedding is not refused |

The mechanism is that `SameSite` is evaluated against the **site**, and a site ignores the port. A local page and the tunnel both live on `127.0.0.1`, so they are the same site and the `SameSite=Strict` cookie is sent; the frame's own document origin is the tunnel origin, so every fetch and WebSocket inside it is same-origin and passes the fence. Authentication must still be established for the tunnel origin first — in this test the cookie was minted by visiting the tunnel URL directly before embedding.

## Decision

Connect over an SSH tunnel, and drive the remote GUI through that tunnel's authority.

```
Local client
  Web GUI:    the local page keeps the host switcher and embeds the active
              remote's GUI in a frame served through the tunnel authority
  Desktop:    Electron shell forwards to the tunnel authority
        |
        | OpenSSH, multiplexed:
        |   -L 127.0.0.1:<fixed local port>:127.0.0.1:<remote port>
        v
Remote machine
  dsh web, bound to 127.0.0.1 (unmodified)
  existing launch token, cookie auth, and /api fence
```

The remote Harness is not modified. It keeps its loopback bind, its token, and its fence. Authentication and trust are the remote's own, reached over an encrypted channel.

Why this shape:

- **A frame is the only way a browser page reaches another origin here.** The measured 403, the absent CORS headers, and the browser-forbidden `Origin`/`sec-fetch-site` headers rule out calling the API across origins from page script. An embedded frame does not cross origins at all: its document *is* the tunnel origin, so its own fetch and WebSocket traffic is same-origin and passes the fence unmodified.
- **It leaves the browser client untouched.** No base-URL plumbing, no transport fork, no server fence change. The remote's own served bundle already speaks to its own origin.
- **It adds no network exposure.** The remote never binds a non-loopback address. This is strictly safer than the `0.0.0.0` alternative, which would publish the tool-capable API to the network over plaintext HTTP with a cookie that omits `Secure`.
- **It requires no new wire protocol.** The existing Typert Remote/Gateway stack, Session and Workspace APIs, and event forwarding all work unchanged.

## Components

### 1. Tunnel owner (new)

One SSH tunnel per configured remote host. Responsibilities: establish the OpenSSH connection, hold it, report readiness, tear it down, and reconnect.

Reuse decision: `packages/ssh/ssh/src/index.ts` already drives OpenSSH with a control master and multiplexed `-O forward -L` control commands, and its `-L` spec form carries over to a fixed TCP port unchanged. But that package's readiness, `Config`, and forwarding API are all helper-bound: it requires `node`, `helper`, `helperHash`, and `workspace`, gates readiness on a helper `hello` handshake plus digest verification, and types its forwards to helper-issued TLS-PSK stream endpoints. It cannot start without an installed remote helper, so it cannot serve a helper-less tunnel.

This design therefore adds a small independent tunnel owner that replicates the proven multiplexing recipe rather than reusing `packages/ssh/ssh`. The generic part is roughly 120 lines and is interwoven there with helper lifecycle, so extraction would be premature for a single new consumer; the natural extraction point is a second forward consumer. The new owner must supply the one piece that package gets from its handshake: master readiness detection (`ssh -O check`).

### 2. Remote host registry (new)

A durable list of configured remote hosts, stored under `$DSH_HOME` (per the user's decision that it travels with the DSH home, not the workspace). Each record carries: a display alias, the OpenSSH host alias, the remote `dsh web` port, the fixed local tunnel port, and the cached browser cookie.

The launch token itself is per-process on the remote and changes on every remote restart; it is not a durable record. What persists is the browser cookie, which survives remote restarts on the same authority for its configured lifetime (30 days by default).

### 3. Host switcher UI (new)

A sidebar entry in the position the Plugins entry occupies, following the `sidebar.panellist` registration pattern in `packages/client/ui-plugin-manager/src/client/index.ts`. The local page keeps this switcher always visible; selecting a host points the frame at that host's tunnel authority, so the whole panel becomes that host's Workspaces, Sessions, and live events. The local host is one of the entries.

Phase-1 scope per the user's decision: manual host entry (SSH host, remote port, token), automatic remote `dsh web` startup when none is running, and reconnect after a dropped tunnel.

Because the switcher stays in the local page while the remote GUI renders in a frame, the local page must first establish the tunnel origin's session — visiting the tunnel's authenticated URL once to mint its cookie — before the frame can load. That bootstrap is part of connecting, not something the user performs.

### 4. Remote lifecycle management (new)

On connect, probe the remote for a listening `dsh web`; if absent, start one detached and capture the launch URL from its stdout. The remote process is never killed by disconnecting — the tunnel closes, the remote keeps running, matching how a manually started `dsh web` behaves.

### 5. Desktop integration (later phase)

The Desktop shell can reach the tunnel authority through the transport hooks it already owns (`apps/desktop/src/main.ts` header forwarding), which is a smaller change than the Web GUI's framing work. It is still deferred: the user's decision is to prove the feature in the Web GUI first, because the Desktop path additionally involves packaging.

## Data flow

1. User selects a remote host in the sidebar.
2. The registry resolves its record; the tunnel owner ensures the SSH tunnel is up on the record's fixed local port.
3. The local page navigates the tunnel origin to the remote's authenticated launch URL once, exchanging the remote's launch token for the authority-bound cookie that the frame will need, and caches that cookie in the record.
4. The local page points its frame at the tunnel authority. The frame's document is that origin, so the remote GUI boots exactly as it would locally: its own bundle, its own Gateway WebSocket, its own Session and Workspace calls.
5. The panel shows the remote Workspaces and Sessions, and they are operated exactly like local ones because the remote Host is doing the work.
6. Switching back to the local host points the frame at the local origin, or dismisses it.

## Error handling

Every failure must name an actionable cause; "connection failed" is not acceptable.

| Failure | Required report |
|---|---|
| SSH authentication refused | Names the host alias and that SSH credentials or the known-host entry must be fixed |
| Remote `dsh` not installed or not on `PATH` | Names that the remote has no runnable `dsh` |
| Remote `dsh web` port occupied by another process | Names the port and that the remote already serves something |
| Token expired after a remote restart | Offers to re-read the token from the remote and retry |
| Tunnel dropped mid-session | Reconnects; if the cookie still validates, no user action is required |
| Local tunnel port already bound | Names the port and the conflicting process |
| Frame shows the remote's 401 | The tunnel-origin session was never established; re-runs the token exchange |

## Security

| Aspect | Property |
|---|---|
| Transport | Encrypted by SSH; the remote never binds a non-loopback address |
| Launch token | Travels only inside the SSH channel; captured from remote stdout, never over the network |
| Credential storage | The cached cookie is written under `$DSH_HOME` with owner-only permissions |
| Trust | The remote's own `/api` fence and browser authentication are unchanged and fully enforced |
| Blast radius | Possession of the cookie authorizes the remote's complete tool-capable API — the same authority a local browser session holds |

New exposure introduced by this design: none beyond the SSH access the user already has.

## Testing

- **Unit:** tunnel owner argv construction, readiness detection, and teardown; registry record round-trip and validation; tunnel-port reservation and conflict reporting.
- **Integration:** a real tunnel in front of a local `dsh web`, proving the token exchange mints an authority-bound cookie and that `/api` calls through the tunnel pass the fence while uncookied calls get 401. This mirrors the measurements recorded above.
- **Embedding:** a local page embedding the tunnel origin, proving the frame boots the remote GUI and issues its own remote API calls, and that the tunnel-origin session is required for the frame to render. This is the behaviour measured in Edge and recorded above.
- **End-to-end:** two Harness instances (local plus one reached through the tunnel), proving the switcher renders the remote's Workspaces and Sessions and that a prompt sent to a remote Session executes on the remote.
- **Snapshot:** the host switcher is a product-user-visible change, so a keyless recorded-session snapshot is required by the repository's testing policy.

## Out of scope

- Merging multiple hosts into one concurrent list (the chosen model is one host at a time).
- Changing the remote Harness in any way.
- TLS termination, reverse-proxy header interpretation, or publishing the remote Web server to a network.
- Killing remote processes on disconnect.

## Open risks

- **Fixed local port.** The cookie is bound to the tunnel authority, so the local port cannot change between runs without forcing a new token exchange. The registry must reserve a stable port per host and report a clear conflict when it is taken.
- **Remote `PATH` under a non-interactive SSH command.** A detached remote `dsh web` is started from a non-login shell, which may not carry the user's `PATH`. The probe must resolve `dsh` explicitly and fail with a clear message when it cannot.
- **Non-interactive SSH authentication.** The tunnel uses batch mode, so an interactive passphrase prompt cannot appear. Hosts requiring one must be pre-authenticated through an agent or a key without a passphrase.
- **Framing is same-site only.** The embedding measurement holds because the local page and the tunnel share the `127.0.0.1` site. A local page served from a different site, or a tunnel exposed on a non-loopback address, would lose the `SameSite=Strict` cookie and the frame would render the remote's 401. Binding the tunnel to loopback is therefore a correctness requirement, not only a security preference.
- **The remote's frame policy is not ours to guarantee.** The remote index currently sends no `X-Frame-Options` or `frame-ancestors`, which is what makes embedding possible. A future remote version could add them, so the end-to-end test must assert the frame actually renders rather than assume it.
