/**
 * The relay's two forwarding paths against fake local upstreams: the HTTP path
 * serves the remote on an origin the relay owns, and the upgrade path replays
 * the handshake so the remote's WebSocket mux answers and streams both ways.
 */

import { once } from 'node:events'
import { createHmac, createHash } from 'node:crypto'
import { createServer, request as httpRequest } from 'node:http'
import type { IncomingHttpHeaders, IncomingMessage, OutgoingHttpHeaders, Server as HttpServer, ServerResponse } from 'node:http'
import { connect as netConnect, createServer as createRawServer } from 'node:net'
import type { AddressInfo, Server as NetServer, Socket as NetSocket } from 'node:net'
import type { Duplex } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { forwardedHeaders, REMOTE_STREAM_MUX_PATH, RemoteRelay } from '../src/relay.ts'

/** Deliberately not a real listener: only a rewrite can put it into an upstream Host. */
const AUTHORITY = 'gui.example:8443'

/** The secret every relay under test signs with. */
const SECRET = Buffer.from('a'.repeat(43), 'base64url')

const closers: Array<() => Promise<void>> = []
const open: Duplex[] = []

afterEach(async () => {
  for (const socket of open.splice(0)) socket.destroy()
  for (const close of closers.splice(0).reverse()) await close()
})

/** Listen on an OS-assigned loopback port and register the close for teardown. */
async function listen(server: HttpServer | NetServer): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  closers.push(() => new Promise<void>((resolve) => {
    if ('closeAllConnections' in server) server.closeAllConnections()
    server.close(() => {
      resolve()
    })
  }))
  return (server.address() as AddressInfo).port
}

/** Wait for a probe to produce a value, failing the test instead of hanging the suite. */
async function until<T>(probe: () => T | undefined): Promise<T> {
  const deadline = Date.now() + 2_000
  for (;;) {
    const value = probe()
    if (value !== undefined) return value
    if (Date.now() > deadline) throw new Error('relay spec: condition not reached')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

/** What the fake remote recorded about one relayed exchange. */
interface SeenExchange {
  method: string | undefined
  url: string | undefined
  headers: IncomingHttpHeaders
  body: string
}

/** A fake remote dsh: a bootable index, a body echo, and a route that dies after a partial body. */
async function startRemoteHttp(): Promise<{ port: number; seen: SeenExchange[] }> {
  const seen: SeenExchange[] = []
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() })
      if (req.url === '/' || req.url?.startsWith('/?') === true) {
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end('<!doctype html><html data-boot="true"><body>remote-gui</body></html>')
        return
      }
      if (req.url === '/echo') {
        res.writeHead(200, { 'content-type': 'text/plain' })
        res.end(Buffer.concat(chunks).toString())
        return
      }
      if (req.url !== '/partial') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end('{"ok":true}')
        return
      }
      // Head plus a partial body, then the socket dies: the relayed response
      // must tear down instead of hanging or ending as if complete.
      res.writeHead(200, { 'content-type': 'text/plain', 'content-length': '64' })
      res.write('partial')
      setImmediate(() => {
        res.socket?.destroy()
      })
    })
  })
  return { port: await listen(server), seen }
}

/** A raw TCP stand-in for the remote stream mux: records the replayed handshake, answers 101, then echoes every byte. */
async function startRemoteMux(): Promise<{
  port: number
  /** The request line and headers the relay replayed, one entry per upgrade. */
  handshakes: string[]
  /** Bytes the relay passed through after each handshake. */
  extra: string[]
  closeUpstreams(): void
  closedCount(): number
}> {
  const handshakes: string[] = []
  const extra: string[] = []
  const sockets = new Set<NetSocket>()
  let closed = 0
  const server = createRawServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => {
      closed += 1
      sockets.delete(socket)
    })
    let buffered = ''
    let upgraded = false
    socket.on('data', (chunk: Buffer) => {
      if (upgraded) {
        extra.push(chunk.toString())
        socket.write(chunk)
        return
      }
      buffered += chunk.toString()
      const end = buffered.indexOf('\r\n\r\n')
      if (end === -1) return
      handshakes.push(buffered.slice(0, end))
      upgraded = true
      socket.write('HTTP/1.1 101 Switching Protocols\r\nupgrade: websocket\r\nconnection: Upgrade\r\n\r\nUPSTREAM-READY')
      const rest = buffered.slice(end + 4)
      if (rest.length > 0) {
        extra.push(rest)
        socket.write(rest)
      }
    })
  })
  const port = await listen(server)
  closers.push(async () => {
    for (const socket of sockets) socket.destroy()
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve()
      })
    })
  })
  return {
    port,
    handshakes,
    extra,
    closeUpstreams: () => {
      for (const socket of sockets) socket.end()
    },
    closedCount: () => closed,
  }
}

/** Reserve one loopback port, releasing it immediately so a relay can bind it. */
async function freePort(): Promise<number> {
  const probe = createRawServer(() => {})
  const port = await listen(probe)
  await new Promise<void>((resolve) => { probe.close(() => { resolve() }) })
  closers.splice(closers.length - 1, 1)
  return port
}

/** Start one relay in front of the given upstream port, registering its teardown. */
async function startRelay(upstreamPort: number, secret: Buffer | undefined): Promise<RemoteRelay> {
  const relay = new RemoteRelay({
    upstream: { host: '127.0.0.1', port: upstreamPort },
    secret,
    port: await freePort(),
  })
  await relay.start()
  closers.push(() => relay.close())
  return relay
}

/** One relayed exchange as the browser sees it. */
interface RelayAnswer {
  status: number
  headers: IncomingHttpHeaders
  body: string
}

/** Issue one request through a relay origin. */
function relayRequest(
  origin: string,
  options: { path: string; method?: string; body?: string; headers?: OutgoingHttpHeaders },
): Promise<RelayAnswer> {
  const url = new URL(origin)
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: url.hostname, port: url.port, path: options.path, method: options.method, headers: options.headers },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => {
          chunks.push(chunk)
        })
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString() })
        })
      },
    )
    req.on('error', reject)
    if (options.body !== undefined) req.write(options.body)
    req.end()
  })
}

/** Issue one request and report a torn response as its own outcome, not as a rejection. */
function tornRequest(origin: string, path: string): Promise<{ kind: string; body: string }> {
  const url = new URL(origin)
  return new Promise((resolve) => {
    let body = ''
    const req = httpRequest({ host: url.hostname, port: url.port, path }, (res) => {
      res.on('data', (chunk: Buffer) => {
        body += chunk.toString()
      })
      // A remote dying mid-body truncates the relayed response: node reports
      // `aborted` because the status line already arrived.
      res.on('aborted', () => { resolve({ kind: 'ABORTED', body }) })
      res.on('end', () => { resolve({ kind: 'END', body }) })
      res.on('error', () => { resolve({ kind: 'ERROR', body }) })
    })
    req.on('error', () => { resolve({ kind: 'REQ_ERROR', body }) })
    req.end()
  })
}

/** Open one browser-style upgrade through a relay origin, collecting everything the socket delivers. */
function relayUpgrade(origin: string, path: string): Promise<{ status: number; socket: Duplex; received: () => string }> {
  const url = new URL(origin)
  return new Promise((resolve, reject) => {
    let text = ''
    const req = httpRequest({
      host: url.hostname,
      port: url.port,
      path,
      headers: {
        connection: 'Upgrade',
        upgrade: 'websocket',
        'sec-websocket-version': '13',
        'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
        origin,
      },
    })
    req.on('upgrade', (res, socket, head) => {
      text = head.toString()
      socket.on('data', (chunk: Buffer) => {
        text += chunk.toString()
      })
      open.push(socket)
      resolve({ status: res.statusCode ?? 0, socket, received: () => text })
    })
    req.on('error', reject)
    req.end()
  })
}

describe('forwardedHeaders', () => {
  it('presents the relay authority and replaces the browser cookie with the minted one', () => {
    const forwarded = forwardedHeaders(
      { host: '127.0.0.1:19387', cookie: 'dsh-auth-local=own' },
      AUTHORITY,
      'dsh-auth-remote=minted',
    )

    expect(forwarded.host).toBe(AUTHORITY)
    expect(forwarded.cookie).toBe('dsh-auth-remote=minted')
    // A browser sends every cookie it holds for a host regardless of port, so
    // the local Host's own session cookie must not reach another machine.
    expect(JSON.stringify(forwarded)).not.toContain('dsh-auth-local')
  })

  it('omits the cookie entirely when no secret was readable', () => {
    const forwarded = forwardedHeaders({ cookie: 'dsh-auth-local=own' }, AUTHORITY, undefined)

    expect(forwarded.cookie).toBeUndefined()
    expect(forwarded.host).toBe(AUTHORITY)
  })

  it('drops this hop\'s framing headers and values that are absent', () => {
    const forwarded = forwardedHeaders(
      { connection: 'keep-alive', te: 'trailers', 'x-kept': 'yes', 'x-empty': undefined },
      AUTHORITY,
      undefined,
    )

    expect(forwarded.connection).toBeUndefined()
    expect(forwarded.te).toBeUndefined()
    expect(forwarded['x-empty']).toBeUndefined()
    expect(forwarded['x-kept']).toBe('yes')
  })
})

describe('RemoteRelay lifecycle', () => {
  it('binds the configured loopback port and reports it', async () => {
    const remote = await startRemoteHttp()
    const relay = await startRelay(remote.port, SECRET)

    expect(relay.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u)
    expect(relay.authority).toBe(new URL(relay.origin).host)
  })

  it('reports no authority before it is started', () => {
    const relay = new RemoteRelay({ upstream: { host: '127.0.0.1', port: 1 }, secret: SECRET })

    expect(() => relay.authority).toThrow(/not started/u)
  })

  it('refuses a second start rather than binding a second origin', async () => {
    const remote = await startRemoteHttp()
    const relay = await startRelay(remote.port, SECRET)

    await expect(relay.start()).rejects.toThrow(/already started/u)
  })

  it('releases its origin on close, and closing twice agrees', async () => {
    const remote = await startRemoteHttp()
    const relay = new RemoteRelay({ upstream: { host: '127.0.0.1', port: remote.port }, secret: SECRET })
    const origin = await relay.start()

    await relay.close()
    await relay.close()

    expect(() => relay.authority).toThrow(/not started/u)
    // The origin is genuinely released, not merely forgotten.
    await expect(new Promise((resolve, reject) => {
      const req = httpRequest(`${origin}/`, () => { resolve('answered') })
      req.on('error', () => { reject(new Error('refused')) })
      req.end()
    })).rejects.toThrow(/refused/u)
  })

  it('rejects a start whose port is already bound, so the caller reports it taken', async () => {
    const blocker = createRawServer(() => {})
    const port = await listen(blocker)
    const relay = new RemoteRelay({ upstream: { host: '127.0.0.1', port: 1 }, secret: SECRET, port })

    // A second bind on the same port fails: the error must reach the caller
    // rather than leaving a half-started relay behind.
    await expect(relay.start()).rejects.toThrow(/EADDRINUSE/u)
    expect(() => relay.authority).toThrow(/not started/u)
  })

  it('closes cleanly when it was never started', async () => {
    const relay = new RemoteRelay({ upstream: { host: '127.0.0.1', port: 1 }, secret: SECRET })

    await expect(relay.close()).resolves.toBeUndefined()
  })
})

describe('RemoteRelay HTTP forwarding', () => {
  it('serves the remote index on the relay origin with a cookie signed for that origin', async () => {
    const remote = await startRemoteHttp()
    const relay = await startRelay(remote.port, SECRET)

    const answer = await relayRequest(relay.origin, { path: '/' })

    expect(answer.status).toBe(200)
    expect(answer.body).toContain('remote-gui')
    const seen = remote.seen[0]!
    // The fence compares Origin.host to Host.host, and the cookie is audience-
    // bound to the authority the browser is on: both must be this relay's own.
    expect(seen.headers.host).toBe(relay.authority)
    const [name, value] = seen.headers.cookie!.split('=')
    expect(name).toBe('dsh-auth-' + createHash('sha256').update(relay.authority).digest('base64url'))
    const [, body, signature] = value!.split('.')
    const payload = JSON.parse(Buffer.from(body!, 'base64url').toString('utf8')) as { authority: string }
    expect(payload.authority).toBe(relay.authority)
    expect(signature).toBe(createHmac('sha256', SECRET).update(body!).digest('base64url'))
  })

  it('serves an API path at the same path rather than stripping a prefix', async () => {
    const remote = await startRemoteHttp()
    const relay = await startRelay(remote.port, SECRET)

    // The remote's own client calls `/api` absolutely, so the relay must serve
    // it at that path on an origin it owns.
    await relayRequest(relay.origin, { path: '/api/session/list', method: 'POST' })

    expect(remote.seen[0]!.url).toBe('/api/session/list')
  })

  it('forwards a path with its query intact', async () => {
    const remote = await startRemoteHttp()
    const relay = await startRelay(remote.port, SECRET)

    await relayRequest(relay.origin, { path: '/?token=abc&x=1' })

    expect(remote.seen[0]!.url).toBe('/?token=abc&x=1')
  })

  it('pipes the request body to the remote untouched', async () => {
    const remote = await startRemoteHttp()
    const relay = await startRelay(remote.port, SECRET)

    const answer = await relayRequest(relay.origin, { path: '/echo', method: 'POST', body: 'payload-bytes' })

    expect(answer.body).toBe('payload-bytes')
  })

  it('drops this hop\'s framing headers instead of forwarding them', async () => {
    const remote = await startRemoteHttp()
    const relay = await startRelay(remote.port, SECRET)

    await relayRequest(relay.origin, { path: '/', headers: { te: 'trailers', 'proxy-authorization': 'secret' } })

    const seen = remote.seen[0]!
    expect(seen.headers.te).toBeUndefined()
    expect(seen.headers['proxy-authorization']).toBeUndefined()
  })

  it('forwards the browser Origin for the relay origin unchanged', async () => {
    const remote = await startRemoteHttp()
    const relay = await startRelay(remote.port, SECRET)

    await relayRequest(relay.origin, { path: '/', headers: { origin: relay.origin, 'sec-fetch-site': 'same-origin' } })

    const seen = remote.seen[0]!
    expect(seen.headers.origin).toBe(relay.origin)
    expect(seen.headers['sec-fetch-site']).toBe('same-origin')
  })

  it('answers 502 when the remote is unreachable', async () => {
    const relay = await startRelay(1, SECRET)

    const answer = await relayRequest(relay.origin, { path: '/' })

    expect(answer.status).toBe(502)
    expect(answer.body).toMatch(/remote host unreachable/u)
  })

  it('tears the response down when the remote dies mid-body', async () => {
    const remote = await startRemoteHttp()
    const relay = await startRelay(remote.port, SECRET)

    // A partial body must surface as a broken exchange, never as a silently
    // complete answer the browser would take for the whole remote response.
    const outcome = await tornRequest(relay.origin, '/partial')

    expect(outcome.kind).toBe('ABORTED')
    expect(outcome.body).not.toContain('complete')
  })

  it('forwards without a cookie when the remote home could not be read', async () => {
    const remote = await startRemoteHttp()
    const relay = await startRelay(remote.port, undefined)

    const answer = await relayRequest(relay.origin, { path: '/' })

    // The relay still serves the surface; the remote answers its own refusal.
    expect(answer.status).toBe(200)
    expect(remote.seen[0]!.headers.cookie).toBeUndefined()
  })
})

describe('RemoteRelay upgrade forwarding', () => {
  it('replays the browser handshake to the remote mux with the relay authority and cookie', async () => {
    const remote = await startRemoteMux()
    const relay = await startRelay(remote.port, SECRET)

    const { status } = await relayUpgrade(relay.origin, REMOTE_STREAM_MUX_PATH)

    expect(status).toBe(101)
    const handshake = await until(() => remote.handshakes[0])
    expect(handshake).toContain(`GET ${REMOTE_STREAM_MUX_PATH} HTTP/1.1`)
    expect(handshake).toContain(`host: ${relay.authority}`)
    expect(handshake).toContain('dsh-auth-')
    // The upgrade carries the same fence as the HTTP path, so its framing
    // headers must survive verbatim for the remote to accept the handshake.
    expect(handshake).toContain('sec-websocket-key: dGhlIHNhbXBsZSBub25jZQ==')
    expect(handshake).toContain('upgrade: websocket')
  })

  it('streams both directions after the upgrade', async () => {
    const remote = await startRemoteMux()
    const relay = await startRelay(remote.port, SECRET)
    const { socket, received } = await relayUpgrade(relay.origin, REMOTE_STREAM_MUX_PATH)
    await until(() => received().includes('UPSTREAM-READY') ? true : undefined)

    socket.write('from-browser')
    await until(() => remote.extra.includes('from-browser') ? true : undefined)

    await until(() => received().includes('from-browser') ? true : undefined)
  })

  it('forwards bytes that arrived with the browser handshake', async () => {
    const remote = await startRemoteMux()
    const relay = await startRelay(remote.port, SECRET)
    const url = new URL(relay.origin)

    // Send the handshake and one frame together, so the frame lands in `head`.
    const socket = netConnect(Number(url.port), url.hostname, () => {
      socket.write([
        `GET ${REMOTE_STREAM_MUX_PATH} HTTP/1.1`,
        `host: ${relay.authority}`,
        'connection: Upgrade',
        'upgrade: websocket',
        'sec-websocket-key: dGhlIHNhbXBsZSBub25jZQ==',
        '', 'HEAD-FRAME',
      ].join('\r\n'))
    })
    open.push(socket)

    await until(() => remote.extra.includes('HEAD-FRAME') ? true : undefined)
  })

  it('joins a repeated header while replaying the handshake', async () => {
    const remote = await startRemoteMux()
    const relay = await startRelay(remote.port, SECRET)
    const url = new URL(relay.origin)

    // Two `set-cookie` lines reach node as an array, unlike most headers.
    const socket = netConnect(Number(url.port), url.hostname, () => {
      socket.write([
        `GET ${REMOTE_STREAM_MUX_PATH} HTTP/1.1`,
        `host: ${relay.authority}`,
        'connection: Upgrade',
        'upgrade: websocket',
        'sec-websocket-key: dGhlIHNhbXBsZSBub25jZQ==',
        'set-cookie: a=1',
        'set-cookie: b=2',
        '', '',
      ].join('\r\n'))
    })
    open.push(socket)

    const handshake = await until(() => remote.handshakes[0])
    expect(handshake).toContain('set-cookie: a=1, b=2')
  })

  it('destroys the browser socket when the remote closes the upgrade', async () => {
    const remote = await startRemoteMux()
    const relay = await startRelay(remote.port, SECRET)
    const { socket } = await relayUpgrade(relay.origin, REMOTE_STREAM_MUX_PATH)
    await until(() => remote.handshakes[0])

    remote.closeUpstreams()

    await once(socket, 'close')
  })

  it('ends the upstream when the browser socket closes', async () => {
    const remote = await startRemoteMux()
    const relay = await startRelay(remote.port, SECRET)
    const { socket } = await relayUpgrade(relay.origin, REMOTE_STREAM_MUX_PATH)
    await until(() => remote.handshakes[0])

    socket.destroy()

    await until(() => remote.closedCount() > 0 ? true : undefined)
  })

  it('ends the upstream when the browser socket errors', async () => {
    const remote = await startRemoteMux()
    const relay = await startRelay(remote.port, SECRET)
    const { socket } = await relayUpgrade(relay.origin, REMOTE_STREAM_MUX_PATH)
    await until(() => remote.handshakes[0])

    socket.destroy(new Error('browser reset'))

    await until(() => remote.closedCount() > 0 ? true : undefined)
  })

  it('ends the upstream when the browser socket resets mid-stream', async () => {
    const remote = await startRemoteMux()
    const relay = await startRelay(remote.port, SECRET)
    const url = new URL(relay.origin)

    await new Promise<void>((resolve) => {
      const socket = netConnect(Number(url.port), url.hostname, () => {
        socket.write([
          `GET ${REMOTE_STREAM_MUX_PATH} HTTP/1.1`,
          `host: ${relay.authority}`,
          'connection: Upgrade',
          'upgrade: websocket',
          'sec-websocket-key: dGhlIHNhbXBsZSBub25jZQ==',
          '', '',
        ].join('\r\n'))
      })
      socket.on('data', () => {
        // An abrupt reset is what raises `error` rather than `close`.
        socket.resetAndDestroy()
        setTimeout(resolve, 50)
      })
      socket.on('error', () => { resolve() })
      setTimeout(resolve, 1_000)
    })

    await until(() => remote.closedCount() > 0 ? true : undefined)
  })

  it('drops the browser socket when the remote is unreachable', async () => {
    const relay = await startRelay(1, SECRET)

    await expect(relayUpgrade(relay.origin, REMOTE_STREAM_MUX_PATH)).rejects.toThrow()
  })

  it('forwards an upgrade without a cookie when no secret was readable', async () => {
    const remote = await startRemoteMux()
    const relay = await startRelay(remote.port, undefined)

    await relayUpgrade(relay.origin, REMOTE_STREAM_MUX_PATH)

    const handshake = await until(() => remote.handshakes[0])
    expect(handshake).toContain(`host: ${relay.authority}`)
    expect(handshake).not.toContain('dsh-auth-')
  })
})

describe('REMOTE_STREAM_MUX_PATH', () => {
  it('names the exact pathname the remote gateway upgrades on', () => {
    expect(REMOTE_STREAM_MUX_PATH).toBe('/api/remote.mux')
  })
})
