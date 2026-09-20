# Remote hosts

English | [中文](remote-hosts.zh.md)

The `remoteHosts` service owned by [`@deepseek-ai/dsh-remote-hosts`](../../packages/remote/remote-hosts/README.md) lets a local Web GUI operate a Harness running on another machine. Each configured host is one validated record plus its SSH password and remote Web access token in the credential store; connecting opens a loopback-only SSH tunnel to that host's own Web server, and the [Web client](../../packages/client/ui-remote-hosts/README.md) frames the tunnel origin so the remote's own GUI boots inside the panel. The group page is [`packages/remote/README.md`](../../packages/remote/README.md).

Source: [`packages/remote/remote-hosts/src/index.ts`](../../packages/remote/remote-hosts/src/index.ts)

## `RemoteHostRow` — one configured host

```ts type-equiv
/** What the Client receives for one configured host; never a password. */
interface RemoteHostRow {
  /** Stable host id. */
  readonly id: string
  /** Operator-facing display name. */
  readonly label: string
  /** SSH host name or address. */
  readonly host: string
  /** SSH port. */
  readonly port: number
  /** Remote login user. */
  readonly user: string
  /** The remote Harness Web port the tunnel forwards to. */
  readonly remotePort: number
  /** The local loopback port the tunnel binds. */
  readonly localPort: number
  /** Whether the host's tunnel is currently live. */
  readonly connected: boolean
}
```

## `RemoteHostAddInput` — the write input

```ts type-equiv
/** Wire input of `remoteHosts.add`: the host fields plus its password. */
interface RemoteHostAddInput {
  /** Stable host id; a duplicate id replaces the existing record. */
  readonly id: string
  /** Operator-facing display name. */
  readonly label: string
  /** SSH host name or address. */
  readonly host: string
  /** SSH port. */
  readonly port: number
  /** Remote login user. */
  readonly user: string
  /** The remote Harness Web port the tunnel forwards to. */
  readonly remotePort: number
  /** The local loopback port the tunnel binds. */
  readonly localPort: number
  /** The SSH password stored under the host's credential record. */
  readonly password: string
  /**
   * The remote Harness's Web launch token, when the operator has one. Blank or
   * absent leaves the frame unauthenticated against the remote.
   */
  readonly webToken?: string
}
```

## `RemoteHostConnection` — one resolved connection

```ts type-equiv
/** One connection's resolved state, as the frame loader needs it. */
interface RemoteHostConnection {
  /** The connected host's id. */
  readonly id: string
  /** The local loopback port the tunnel listens on. */
  readonly localPort: number
  /** The tunnel origin the remote's API is reached through. */
  readonly origin: string
  /**
   * The absolute URL the frame loads. The remote's Web server authenticates its
   * root request with its launch token, so a stored token rides this URL and the
   * exchange mints the cookie bound to the tunnel authority. Without a token
   * this is the bare origin and the frame shows the remote's own refusal.
   */
  readonly frameUrl: string
}
```

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxremotehosts--remotehostcontroller"></a>

### `ctx.remoteHosts` — `RemoteHostController`

Host service backing the generated `ctx.remote.remoteHosts` namespace.

```ts cordis-catalog
/**
 * Every configured host and whether its tunnel is live.
 * @returns the rows the host switcher renders.
 */
@Remote('list') remoteExportList(): Promise<RemoteHostRow[]>

/**
 * Add or replace one host and store its SSH password.
 * @param input - the host fields plus its password.
 * @returns the stored host's row.
 */
@Remote('add') async remoteExportAdd(input: RemoteHostAddInput): Promise<RemoteHostRow>

/**
 * Forget one host, its stored password, and its tunnel.
 * @param id - the host to remove; an unknown id resolves without effect.
 */
@Remote('delete') async remoteExportRemove(id: string): Promise<void>

/**
 * Open the host's tunnel so its GUI can load. Opening an already-connected
 * host returns the live connection.
 * @param id - the host to connect.
 * @returns the loopback origin the frame loads from.
 */
@Remote('connect') async remoteExportConnect(id: string): Promise<RemoteHostConnection>

/**
 * Close one host's tunnel. The remote process keeps running.
 * @param id - the host to disconnect; an unconnected id resolves without effect.
 */
@Remote('disconnect') async remoteExportDisconnect(id: string): Promise<void>
```

Source: [`packages/remote/remote-hosts/src/index.ts`](../../packages/remote/remote-hosts/src/index.ts)
<!-- END GENERATED cordis-surface -->

## Measured transport behavior

The design rests on behavior measured against a running Harness, recorded in the [design note](../superpowers/specs/2026-09-20-remote-host-connection-design.md):

- The remote's `/api` fence accepts a request only when its `Host` is loopback or a declared `trustedHosts` authority, and the server sends no `Access-Control-Allow-*` header while answering an `OPTIONS` preflight with 403. A page therefore cannot call another origin's API, which is why the frame is load-bearing rather than an optimization.
- The issued cookie's signed payload carries the **tunnel** authority, so the page must be loaded through the authority the API is called on. The frame's own document origin is the tunnel origin, and `SameSite` ignores the port, so the local page and the tunnel share a site.
- The remote index sends no `X-Frame-Options` and no `frame-ancestors`, so embedding is not refused. That is the remote's property, not this group's guarantee, which is why the assembled-Web test asserts rendered frame content rather than a status code.
- Host-key trust uses `StrictHostKeyChecking=accept-new` against a DSH-owned `known_hosts`: a first connect records the key while a substituted key is still refused.
