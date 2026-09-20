# 远端主机

[English](remote-hosts.md) | 中文

由 [`@deepseek-ai/dsh-remote-hosts`](../../packages/remote/remote-hosts/README.zh.md) 拥有的 `remoteHosts` 服务让本地 Web GUI 操作运行在另一台机器上的 Harness。每台已配置主机是一条校验记录，外加存于凭据库中的 SSH 密码与远端 Web 访问令牌；连接会向该主机自己的 Web 服务器打开仅绑回环的 SSH 隧道，而 [Web 客户端](../../packages/client/ui-remote-hosts/README.zh.md) 加载隧道源，于是远端自己的 GUI 就在面板内启动。包组页面见 [`packages/remote/README.zh.md`](../../packages/remote/README.zh.md)。

来源：[`packages/remote/remote-hosts/src/index.ts`](../../packages/remote/remote-hosts/src/index.ts)

## `RemoteHostRow`——一台已配置主机

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

## `RemoteHostAddInput`——写入输入

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

## `RemoteHostConnection`——一次已解析的连接

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

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

## 实测的传输行为

本设计依托于对运行中的 Harness 实测得到的行为，记录见[设计说明](../superpowers/specs/2026-09-20-remote-host-connection-design.zh.md)：

- 远端的 `/api` 围栏只在其 `Host` 为回环或已声明的 `trustedHosts` 权威时接受请求，且服务器不发送任何 `Access-Control-Allow-*` 头，并以 403 应答 `OPTIONS` 预检。因此页面无法调用其他源的 API——这正是框架不可或缺、而非优化手段的原因。
- 签发 cookie 的签名载荷携带的是**隧道**权威，所以页面必须从它所调用的 API 所在的权威加载。框架自身文档的源就是隧道源，而 `SameSite` 忽略端口，于是本地页面与隧道同属一个站点。
- 远端首页不发送 `X-Frame-Options`，也不发送 `frame-ancestors`，因此嵌入不被拒绝。那是远端自身的性质，不是本包组的保证——这正是组装后的 Web 测试断言框架内实际渲染内容、而非仅断言状态码的原因。
- 主机密钥信任使用 `StrictHostKeyChecking=accept-new` 并配合 DSH 自有的 `known_hosts`：首次连接会记录密钥，而被替换的密钥仍会被拒绝。
