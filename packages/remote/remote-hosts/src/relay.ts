/**
 * Reverse proxy carrying one remote Harness Web surface, so the Web GUI can
 * operate another machine's sessions through a loopback origin that behaves
 * exactly like a local one.
 *
 * The relay owns its own loopback origin rather than claiming a path prefix of
 * the local one. A remote page cannot be served under a local prefix: its
 * client calls `/api` as an absolute path, so a page at `<local>/remote/<id>/`
 * sends those calls to `<local>/api` — the LOCAL Host — and the remote's
 * sessions never appear. Serving the page from an origin the relay owns is what
 * makes the bare `/api` resolve back to the relay.
 *
 * The remote's browser-trust fence (`isTrustedApiRequest`) requires
 * `Origin.host` to equal `Host.host` exactly, and the browser attaches its own
 * `Origin`. Every forwarded request therefore presents the relay's authority in
 * `Host`, which is also the authority the minted session cookie is signed for.
 * @module @deepseek-ai/dsh-remote-hosts/src/relay
 */

import { createServer, request as httpRequest } from 'node:http'
import type { IncomingHttpHeaders, IncomingMessage, OutgoingHttpHeaders, Server, ServerResponse } from 'node:http'
import { connect as netConnect } from 'node:net'
import type { AddressInfo, Socket } from 'node:net'
import type { Duplex } from 'node:stream'
import { mintSessionCookie } from './auth.ts'

/** Exact pathname the remote's Typert gateway upgrades its event streams on. */
export const REMOTE_STREAM_MUX_PATH = '/api/remote.mux'

/** The loopback address the relay binds; a remote surface is never reachable off this machine. */
const LOOPBACK = '127.0.0.1'

/** Headers never forwarded: they describe this hop's framing, which the forwarding client remakes. */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

/**
 * Request headers to forward upstream: the relay's authority replaces `Host`,
 * the headers describing this hop's framing are dropped, and `Cookie` is
 * replaced by the minted session cookie.
 *
 * The browser sends every cookie it holds for a host regardless of port, so the
 * incoming `Cookie` may carry the LOCAL Host's own session cookie; replacing it
 * keeps that cookie from reaching another machine.
 * @param headers - the incoming request's headers.
 * @param authority - the authority the relay is reached by.
 * @param cookie - the session cookie to present, or undefined to send none.
 * @returns headers for the upstream request.
 */
export function forwardedHeaders(
  headers: IncomingHttpHeaders,
  authority: string,
  cookie: string | undefined,
): OutgoingHttpHeaders {
  const kept = Object.entries(headers).filter(([name, value]) =>
    value !== undefined && !HOP_BY_HOP.has(name) && name !== 'host' && name !== 'cookie')
  return {
    ...Object.fromEntries(kept),
    host: authority,
    ...cookie === undefined ? {} : { cookie },
  }
}

/** The upstream a relay forwards to: one connected host's SSH tunnel listener. */
export interface RelayUpstream {
  /** Hostname reaching the remote Web surface. */
  readonly host: string
  /** Port reaching the remote Web surface. */
  readonly port: number
}

/** Facts one relay needs: where the remote surface is reachable and how to authenticate to it. */
export interface RemoteRelayOptions {
  /** Where the remote Web surface is reached — the host tunnel's loopback side. */
  readonly upstream: RelayUpstream
  /**
   * Loopback port this relay binds. The host record owns it, so the origin is
   * stable across reconnects; a port already in use fails the start.
   */
  readonly port: number
  /**
   * The remote Harness's browser-session signing secret. Absent when the remote
   * home could not be read; the relay then forwards without a cookie and the
   * remote answers its own authentication message.
   */
  readonly secret: Buffer | undefined
}

/**
 * One remote host's reverse proxy. {@link start} binds a loopback origin that
 * serves the remote's whole Web face; {@link close} releases it.
 */
export class RemoteRelay {
  private server: Server | undefined
  private bound: AddressInfo | undefined
  private readonly sockets = new Set<Socket>()
  private closing: Promise<void> | undefined

  /**
   * @param options - the remote reach and the signing secret authenticating to it.
   */
  constructor(private readonly options: RemoteRelayOptions) {}

  /** The `host:port` this relay is reached by; the authority its cookie is signed for. */
  get authority(): string {
    if (this.bound === undefined) throw new Error('remote-relay: not started')
    return `${LOOPBACK}:${String(this.bound.port)}`
  }

  /** The origin the browser navigates to for this host. */
  get origin(): string {
    return `http://${this.authority}`
  }

  /**
   * Bind the relay's loopback origin on the host's configured port.
   * @returns the bound origin.
   * @throws when the port is already bound, so the caller reports it as taken.
   */
  async start(): Promise<string> {
    if (this.server !== undefined) throw new Error('remote-relay: already started')
    const server = createServer((req, res) => { this.handle(req, res) })
    server.on('upgrade', (req, socket, head) => { this.handleUpgrade(req, socket, head) })
    // An upgraded socket outlives `close()`; tracking every connection is what
    // lets teardown settle instead of hanging on an open stream.
    server.on('connection', (socket: Socket) => {
      this.sockets.add(socket)
      socket.on('close', () => { this.sockets.delete(socket) })
    })
    await new Promise<void>((resolve, reject) => {
      const failed = (error: Error): void => { reject(error) }
      server.once('error', failed)
      server.listen(this.options.port, LOOPBACK, () => {
        server.off('error', failed)
        resolve()
      })
    })
    this.server = server
    this.bound = server.address() as AddressInfo
    return this.origin
  }

  /**
   * Release the relay's origin and every connection it holds. Closing twice
   * settles on the same promise, so a disposer and a disconnect can both call it.
   */
  async close(): Promise<void> {
    this.closing ??= this.release()
    await this.closing
  }

  /** Release the server and its sockets; recorded once so repeated closes agree. */
  private async release(): Promise<void> {
    const server = this.server
    this.server = undefined
    if (server === undefined) return
    for (const socket of this.sockets) socket.destroy()
    this.sockets.clear()
    await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
    this.bound = undefined
  }

  /**
   * The cookie to present upstream for this relay's own authority, or undefined
   * when the remote's secret could not be read.
   * @returns the `name=value` cookie pair, or undefined.
   */
  private cookie(): string | undefined {
    const secret = this.options.secret
    return secret === undefined ? undefined : mintSessionCookie(secret, this.authority, Date.now())
  }

  /**
   * Forward one request to the remote: `Host` becomes this relay's authority,
   * hop-by-hop headers are dropped, and the remote's answer is piped back
   * unmodified. One failure path serves the exchange — before the remote's
   * response head the request fails with 502, and after it no HTTP failure
   * exists, so the response is torn down instead of truncated silently.
   * @param req - the browser request.
   * @param res - the response owned by this exchange.
   */
  private handle(req: IncomingMessage, res: ServerResponse): void {
    const fail = (error: Error): void => {
      if (res.headersSent) {
        res.destroy()
        return
      }
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(`remote host unreachable: ${error.message}`)
    }
    const upstream = httpRequest(
      {
        host: this.options.upstream.host,
        port: this.options.upstream.port,
        /* v8 ignore next -- `?? '/'` arm: node:http always sets url on server requests. */
        path: req.url ?? '/',
        method: req.method,
        headers: forwardedHeaders(req.headers, this.authority, this.cookie()),
      },
      (response) => {
        /* v8 ignore next -- node:http always sets statusCode on a received response; the field is optional only on the client-side type */
        res.writeHead(response.statusCode ?? 502, response.headers)
        // An upstream dying mid-body must reach this exchange's failure path
        // rather than hanging the browser.
        response.on('error', fail)
        response.pipe(res)
      },
    )
    upstream.on('error', fail)
    req.pipe(upstream)
  }

  /**
   * Forward one upgrade to the remote. The raw request line and every header
   * are re-sent verbatim (`Sec-WebSocket-*` included), so the remote's own
   * fence judges the handshake; only `Host` and `Cookie` are replaced, for the
   * same reasons the HTTP path replaces them.
   *
   * An upgraded pair has no HTTP answer left, so a close or failure on either
   * side can only end the exchange: each end destroys the other rather than
   * leaving half the pair behind.
   * @param req - the upgrade request.
   * @param socket - the browser-side socket of the upgrade.
   * @param head - bytes that arrived with the handshake.
   */
  private handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    /* v8 ignore next -- node:http sets method and url before an upgrade reaches a handler. */
    const lines = [`${req.method ?? 'GET'} ${req.url ?? '/'} HTTP/1.1`]
    for (const [name, value] of Object.entries(req.headers)) {
      /* v8 ignore next -- node:http never yields a valueless header from the wire. */
      if (value === undefined || name === 'host' || name === 'cookie') continue
      lines.push(`${name}: ${Array.isArray(value) ? value.join(', ') : value}`)
    }
    const cookie = this.cookie()
    lines.push(`host: ${this.authority}`)
    if (cookie !== undefined) lines.push(`cookie: ${cookie}`)
    lines.push('', '')

    const upstream = netConnect(this.options.upstream.port, this.options.upstream.host, () => {
      upstream.write(lines.join('\r\n'))
      upstream.write(head)
      upstream.pipe(socket)
      socket.pipe(upstream)
    })
    upstream.on('error', () => { socket.destroy() })
    upstream.on('close', () => { socket.destroy() })
    socket.on('error', () => { upstream.destroy() })
    // A graceful browser close carries no `error`; half of the pair must not outlive the other.
    socket.on('close', () => { upstream.destroy() })
  }
}
