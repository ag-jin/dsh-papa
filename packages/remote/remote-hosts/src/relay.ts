/**
 * The reverse proxy that serves one remote host's whole Web surface from a
 * local origin. It carries ordinary HTTP and the `/api/remote.mux` WebSocket
 * upgrade, and it presents the local authority upstream so the remote's own
 * request fence accepts every forwarded request.
 * @module @deepseek-ai/dsh-remote-hosts/src/relay
 */

import { request as httpRequest } from 'node:http'
import { connect as netConnect } from 'node:net'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'

/** The upstream this relay forwards to: one connected host's loopback tunnel. */
export interface RelayUpstream {
  /** Loopback host the tunnel listens on. */
  readonly host: string
  /** Loopback port the tunnel listens on. */
  readonly port: number
}

/** One relay's inputs. */
export interface RemoteRelayOptions {
  /** The connected host's tunnel. */
  readonly upstream: RelayUpstream
  /**
   * The authority this relay is reached by, written into the upstream `Host`.
   *
   * The remote's request fence refuses a request whose `Origin` host differs
   * from its `Host` host, so forwarding the browser's own authority is what
   * keeps the request self-consistent. It is also what makes the session
   * cookie usable: the remote signs it for the authority it is asked about.
   */
  readonly authority: string
}

/** Headers never forwarded upstream: the connection framing is remade per hop. */
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
 * Copy a request's headers, replacing the authority and dropping the headers
 * that describe this hop's framing rather than the request.
 * @param headers - the incoming request's headers.
 * @param authority - the authority to present upstream.
 * @returns headers to send upstream.
 */
function upstreamHeaders(headers: IncomingMessage['headers'], authority: string): Record<string, string | string[]> {
  const forwarded: Record<string, string | string[]> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || HOP_BY_HOP.has(name.toLowerCase()) || name.toLowerCase() === 'host') continue
    forwarded[name] = value
  }
  forwarded.host = authority
  return forwarded
}

/**
 * One remote host's reverse proxy. `register` claims the local routes the
 * remote's page needs; every request then travels to the host's tunnel.
 */
export class RemoteRelay {
  /**
   * @param options - the tunnel to forward to and the authority to present.
   */
  constructor(private readonly options: RemoteRelayOptions) {}

  /**
   * Forward one ordinary HTTP request to the tunnel.
   * @param req - the incoming request.
   * @param res - the response to write the upstream answer into.
   */
  handle(req: IncomingMessage, res: ServerResponse): void {
    const upstream = httpRequest({
      host: this.options.upstream.host,
      port: this.options.upstream.port,
      /* v8 ignore next -- `?? '/'` arm: node:http always sets url on server requests. */
      path: req.url ?? '/',
      method: req.method,
      headers: upstreamHeaders(req.headers, this.options.authority),
    }, (answer) => {
      /* v8 ignore next -- `?? 502` arm: node:http always sets statusCode on a response. */
      res.writeHead(answer.statusCode ?? 502, answer.headers)
      answer.pipe(res)
    })
    upstream.on('error', (error: Error) => {
      // The tunnel is gone or the remote stopped answering. Report it on the
      // response rather than throwing into the server's request callback.
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(`remote host unreachable: ${error.message}`)
    })
    req.pipe(upstream)
  }

  /**
   * Forward one WebSocket upgrade to the tunnel. The upstream handshake is
   * replayed verbatim so the `Sec-WebSocket-*` headers reach the remote
   * unchanged; only the authority is rewritten.
   * @param req - the incoming upgrade request.
   * @param socket - the client socket the upgraded stream is written to.
   * @param head - bytes already read past the request headers.
   */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    /* v8 ignore next -- node:http sets method and url before an upgrade reaches a handler. */
    const lines = [`${req.method ?? 'GET'} ${req.url ?? '/'} HTTP/1.1`]
    for (const [name, value] of Object.entries(req.headers)) {
      /* v8 ignore next -- Object.entries never yields an undefined value for a present header. */
      if (value === undefined || name.toLowerCase() === 'host') continue
      lines.push(`${name}: ${Array.isArray(value) ? value.join(', ') : value}`)
    }
    lines.push(`host: ${this.options.authority}`, '', '')

    const upstream = netConnect(this.options.upstream.port, this.options.upstream.host, () => {
      upstream.write(lines.join('\r\n'))
      if (head.length > 0) upstream.write(head)
      upstream.pipe(socket)
      socket.pipe(upstream)
    })
    upstream.on('error', () => { socket.destroy() })
    /* v8 ignore next -- a client reset mid-stream: the upstream teardown it
       performs is already covered by the tunnel-gone case above. */
    socket.on('error', () => { upstream.destroy() })
  }
}
