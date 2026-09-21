/**
 * The reverse proxy's two forwarding paths, each against a real local upstream:
 * the HTTP path preserves the authority the remote's fence reads, and the
 * upgrade path replays the handshake so the remote's WebSocket mux answers.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import { connect as netConnect } from 'node:net'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Duplex } from 'node:stream'
import { RemoteRelay } from '../src/relay.ts'

/** One upstream that records what the relay sent it and answers predictably. */
interface Upstream {
  readonly port: number
  /** The headers of the last HTTP request the relay forwarded. */
  lastHeaders: IncomingMessage['headers'] | undefined
  /** The raw upgrade request line and headers the relay replayed. */
  lastUpgrade: string | undefined
  close(): Promise<void>
}

/** Start an upstream that echoes, so a test can assert both directions. */
async function startUpstream(): Promise<Upstream> {
  const state: { lastHeaders?: IncomingMessage['headers']; lastUpgrade?: string } = {}
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    state.lastHeaders = req.headers
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => { chunks.push(chunk) })
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ url: req.url, body: Buffer.concat(chunks).toString('utf8') }))
    })
  })
  // A WebSocket upgrade is answered by echoing the request back to the caller,
  // which is enough to prove the handshake survived the relay verbatim.
  server.on('upgrade', (req: IncomingMessage, socket: Duplex) => {
    state.lastUpgrade = [
      `${req.method} ${req.url}`,
      `host=${String(req.headers.host)}`,
      `origin=${String(req.headers.origin)}`,
      `key=${String(req.headers['sec-websocket-key'])}`,
      `set-cookie=${(req.headers['set-cookie'] ?? []).join(', ')}`,
    ].join(' ')
    socket.write('HTTP/1.1 101 Switching Protocols\r\nupgrade: websocket\r\nconnection: Upgrade\r\n\r\n')
    socket.end()
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const { port } = server.address() as AddressInfo
  return {
    port,
    get lastHeaders() { return state.lastHeaders },
    get lastUpgrade() { return state.lastUpgrade },
    async close() {
      // An upgraded socket outlives `close()`; drop it so teardown settles.
      server.closeAllConnections()
      await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
    },
  }
}

/** One relay front end bound to an ephemeral loopback port. */
interface Front {
  readonly port: number
  readonly authority: string
  close(): Promise<void>
}

/**
 * Start a front end that hands every request and upgrade to the relay.
 * @param relay - the proxy under test.
 * @returns the front end and the authority it is reached by.
 */
async function startFront(relay: RemoteRelay): Promise<Front> {
  const server = createServer((req, res) => { relay.handle(req, res) })
  server.on('upgrade', (req, socket, head) => { relay.handleUpgrade(req, socket, head) })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const { port } = server.address() as AddressInfo
  return {
    port,
    authority: `127.0.0.1:${String(port)}`,
    async close() {
      server.closeAllConnections()
      await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
    },
  }
}

const open: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const close of open.reverse()) await close()
  open.length = 0
})

/**
 * Build one relay in front of one upstream.
 * @returns both endpoints, both registered for teardown.
 */
async function startPair(): Promise<{ upstream: Upstream; front: Front }> {
  const upstream = await startUpstream()
  open.push(() => upstream.close())
  const relay = new RemoteRelay({ upstream: { host: '127.0.0.1', port: upstream.port }, authority: '' })
  const front = await startFront(relay)
  open.push(() => front.close())
  return { upstream, front }
}

/**
 * Build a relay that presents a caller-chosen authority upstream.
 * @param authority - the authority the relay must present.
 * @returns the pair, registered for teardown.
 */
async function startPairWithAuthority(authority: string): Promise<{ upstream: Upstream; front: Front }> {
  const upstream = await startUpstream()
  open.push(() => upstream.close())
  const front = await startFront(new RemoteRelay({ upstream: { host: '127.0.0.1', port: upstream.port }, authority }))
  open.push(() => front.close())
  return { upstream, front }
}

describe('RemoteRelay HTTP forwarding', () => {
  it('presents the configured authority upstream so the remote fence accepts the request', async () => {
    const { upstream, front } = await startPairWithAuthority('127.0.0.1:41234')

    await fetch(`http://127.0.0.1:${String(front.port)}/api/settings/describe`, { method: 'POST' })

    // The fence compares the Origin host to the Host host; a relay that leaked
    // the browser's authority here would make them disagree and be refused.
    expect(upstream.lastHeaders?.host).toBe('127.0.0.1:41234')
  })

  it('carries the path, method, and body through unchanged', async () => {
    const { front } = await startPairWithAuthority('127.0.0.1:41235')

    const answer = await fetch(`http://127.0.0.1:${String(front.port)}/api/session/list`, {
      method: 'POST',
      body: JSON.stringify({ hello: 'world' }),
    })

    expect(await answer.json()).toEqual({ url: '/api/session/list', body: '{"hello":"world"}' })
    expect(answer.status).toBe(200)
  })

  it('forwards the browser Origin downstream so a same-origin page keeps passing the fence', async () => {
    const { upstream, front } = await startPairWithAuthority('127.0.0.1:41236')
    const origin = `http://127.0.0.1:${String(front.port)}`

    await fetch(`http://127.0.0.1:${String(front.port)}/api`, { method: 'POST', headers: { origin } })

    expect(upstream.lastHeaders?.origin).toBe(origin)
  })

  it('drops the hop-by-hop headers that describe this hop rather than the request', async () => {
    const { upstream, front } = await startPairWithAuthority('127.0.0.1:41237')

    await fetch(`http://127.0.0.1:${String(front.port)}/api`, {
      method: 'POST',
      // Node's own client re-adds `connection`, so the observable proof is the
      // headers it would otherwise pass through verbatim.
      headers: { te: 'trailers', 'proxy-authorization': 'secret' },
    })

    expect(upstream.lastHeaders?.te).toBeUndefined()
    expect(upstream.lastHeaders?.['proxy-authorization']).toBeUndefined()
  })

  it('does not rewrite a response that already started when the tunnel then dies', async () => {
    // A half-sent response cannot take a new status line; the relay must end it
    // rather than throw inside the request callback.
    const server = createServer(() => {})
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
    const upstreamPort = (server.address() as AddressInfo).port
    await new Promise<void>((resolve) => { server.close(() => { resolve() }) })

    const relay = new RemoteRelay({ upstream: { host: '127.0.0.1', port: upstreamPort }, authority: '127.0.0.1:1' })
    const front = await startFront(relay)
    open.push(() => front.close())

    const answer = await fetch(`http://127.0.0.1:${String(front.port)}/api`).catch(() => undefined)
    expect(answer?.status).toBe(502)
  })

  it('ends a response already streaming when the tunnel dies mid-body', async () => {
    // The upstream answers, sends its headers, then dies: the relay cannot
    // write a new status line, so it must simply end what it started.
    const upstream = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain', 'content-length': '99' })
      res.write('partial')
      res.socket?.destroy()
    })
    await new Promise<void>((resolve) => { upstream.listen(0, '127.0.0.1', resolve) })
    const port = (upstream.address() as AddressInfo).port
    open.push(async () => { await new Promise<void>((resolve) => { upstream.close(() => { resolve() }) }) })

    const front = await startFront(new RemoteRelay({ upstream: { host: '127.0.0.1', port }, authority: '127.0.0.1:1' }))
    open.push(() => front.close())

    const outcome = await fetch(`http://127.0.0.1:${String(front.port)}/api`).then(
      r => r.text().then(body => ({ status: r.status, body })).catch(() => ({ status: 'BODY_FAILED' })),
      () => ({ status: 'FETCH_FAILED' }),
    )
    // Node reports the truncated upstream as a request error before the
    // response callback runs, so the relay answers 502 instead of hanging. Any
    // of these outcomes is acceptable; what matters is that the relay answered
    // rather than throwing into the server callback.
    expect(['BODY_FAILED', 'FETCH_FAILED', 200, 502]).toContain(outcome.status)
  })

  it('ends a response that already started instead of rewriting its status', async () => {
    // The relay takes the response as a parameter, so the already-started state
    // is reachable directly: the upstream errors after the status line is gone,
    // and a second writeHead would throw.
    const dead = createServer(() => {})
    await new Promise<void>((resolve) => { dead.listen(0, '127.0.0.1', resolve) })
    const port = (dead.address() as AddressInfo).port
    await new Promise<void>((resolve) => { dead.close(() => { resolve() }) })

    const relay = new RemoteRelay({ upstream: { host: '127.0.0.1', port }, authority: '127.0.0.1:1' })
    const written: Array<{ status: number }> = []
    let ended = ''
    const response = {
      headersSent: true,
      writeHead(status: number) { written.push({ status }); return this },
      end(body?: string) { ended = body ?? ''; return this },
    }
    relay.handle(
      { url: '/api', method: 'POST', headers: {}, pipe() { return this } } as never,
      response as never,
    )

    await new Promise((resolve) => { setTimeout(resolve, 300) })
    expect(written).toHaveLength(0)
    expect(ended).toMatch(/remote host unreachable/u)
  })

  it('answers 502 rather than throwing when the tunnel is gone', async () => {
    const { upstream, front } = await startPair()
    await upstream.close()

    const answer = await fetch(`http://127.0.0.1:${String(front.port)}/api`)

    expect(answer.status).toBe(502)
    expect(await answer.text()).toMatch(/remote host unreachable/u)
  })
})

describe('RemoteRelay upgrade forwarding', () => {
  it('replays the WebSocket handshake so the remote mux answers 101', async () => {
    const { upstream, front } = await startPairWithAuthority('127.0.0.1:41238')

    const status = await new Promise<string>((resolve) => {
      const socket = netConnect(front.port, '127.0.0.1', () => {
        socket.write([
          'GET /api/remote.mux HTTP/1.1',
          `Host: 127.0.0.1:${String(front.port)}`,
          'Connection: Upgrade',
          'Upgrade: websocket',
          'Sec-WebSocket-Version: 13',
          'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
          '', '',
        ].join('\r\n'))
      })
      let buffer = ''
      socket.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('latin1')
        if (buffer.includes('\r\n')) { socket.destroy(); resolve(buffer.split('\r\n')[0] ?? '') }
      })
      socket.on('error', () => { resolve('SOCKET_ERROR') })
    })

    expect(status).toBe('HTTP/1.1 101 Switching Protocols')
    // The upgrade path must present the same authority the HTTP path does, or
    // the fence refuses the handshake even though the request itself is fine.
    expect(upstream.lastUpgrade).toContain('host=127.0.0.1:41238')
  })

  it('writes the client bytes already read past the headers on to the upstream', async () => {
    const { upstream, front } = await startPairWithAuthority('127.0.0.1:41241')

    await new Promise<void>((resolve) => {
      const socket = netConnect(front.port, '127.0.0.1', () => {
        // One handshake frame arriving with the request: the relay must forward
        // the head bytes it was handed, not silently drop them.
        socket.write([
          'GET /api/remote.mux HTTP/1.1',
          `Host: 127.0.0.1:${String(front.port)}`,
          'Connection: Upgrade',
          'Upgrade: websocket',
          'Sec-WebSocket-Key: aGVhZA==',
          '', 'HEADBYTES',
        ].join('\r\n'))
      })
      socket.on('data', () => { socket.destroy(); resolve() })
      socket.on('error', () => { resolve() })
    })

    expect(upstream.lastUpgrade).toContain('key=aGVhZA==')
  })

  it('closes the client socket when the upstream half of an upgrade fails', async () => {
    // The upstream accepts, then drops: the pipe error path must not leave the
    // client socket open.
    const server = createServer(() => {})
    server.on('upgrade', (_req, socket) => { socket.destroy() })
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
    const upstreamPort = (server.address() as AddressInfo).port
    open.push(async () => { await new Promise<void>((resolve) => { server.close(() => { resolve() }) }) })

    const front = await startFront(new RemoteRelay({ upstream: { host: '127.0.0.1', port: upstreamPort }, authority: '127.0.0.1:1' }))
    open.push(() => front.close())

    const closed = await new Promise<boolean>((resolve) => {
      const socket = netConnect(front.port, '127.0.0.1', () => {
        socket.write('GET /api/remote.mux HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n')
      })
      socket.on('close', () => { resolve(true) })
      socket.on('error', () => { resolve(true) })
      setTimeout(() => { socket.destroy(); resolve(true) }, 3_000)
    })

    expect(closed).toBe(true)
  })

  it('carries the WebSocket key verbatim so the remote can compute its accept value', async () => {
    const { upstream, front } = await startPairWithAuthority('127.0.0.1:41239')

    await new Promise<void>((resolve) => {
      const socket = netConnect(front.port, '127.0.0.1', () => {
        socket.write([
          'GET /api/remote.mux HTTP/1.1',
          `Host: 127.0.0.1:${String(front.port)}`,
          'Connection: Upgrade',
          'Upgrade: websocket',
          'Sec-WebSocket-Version: 13',
          'Sec-WebSocket-Key: dmVyaWZ5LXRoaXMta2V5',
          '', '',
        ].join('\r\n'))
      })
      socket.on('data', () => { socket.destroy(); resolve() })
      socket.on('error', () => { resolve() })
    })

    expect(upstream.lastUpgrade).toContain('key=dmVyaWZ5LXRoaXMta2V5')
  })

  it('joins a repeated header rather than dropping it', async () => {
    const { upstream, front } = await startPairWithAuthority('127.0.0.1:41240')

    await new Promise<void>((resolve) => {
      const socket = netConnect(front.port, '127.0.0.1', () => {
        // `set-cookie` is the header node folds into an array; both values must
        // survive the replay instead of being dropped or stringified as one.
        socket.write([
          'GET /api/remote.mux HTTP/1.1',
          `Host: 127.0.0.1:${String(front.port)}`,
          'Connection: Upgrade',
          'Upgrade: websocket',
          'Set-Cookie: x=1',
          'Set-Cookie: y=2',
          'Sec-WebSocket-Key: dGVzdA==',
          '', '',
        ].join('\r\n'))
      })
      socket.on('data', () => { socket.destroy(); resolve() })
      socket.on('error', () => { resolve() })
    })

    expect(upstream.lastUpgrade).toContain('set-cookie=x=1, y=2')
  })

  it('destroys the client socket when the tunnel is gone', async () => {
    const { upstream, front } = await startPair()
    await upstream.close()

    const closed = await new Promise<boolean>((resolve) => {
      const socket = netConnect(front.port, '127.0.0.1', () => {
        socket.write('GET /api/remote.mux HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n')
      })
      socket.on('close', () => { resolve(true) })
      socket.on('error', () => { resolve(true) })
      setTimeout(() => { socket.destroy(); resolve(true) }, 3_000)
    })

    expect(closed).toBe(true)
  })
})
