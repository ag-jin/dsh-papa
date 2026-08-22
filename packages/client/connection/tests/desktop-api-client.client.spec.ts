/**
 * DesktopApiClient: renderer-safe bridge carrier. The transport is a fake
 * DesktopBridge contract (JSON-only request/response/event values), so these
 * tests exercise the client boundary without importing Electron, Node, fs, or
 * EventEmitter.
 */
import { describe, expect, it, vi } from 'vitest'
import type {
  MuxFrame,
  ServerRequest,
  ServerResponse,
  SessionId,
} from '../src/client/api.ts'
import { RpcId } from '../src/client/api.ts'
import { DesktopApiClient } from '../src/client/desktop-api-client.ts'
import type {
  DesktopBridge,
  DesktopRequest,
} from '../src/client/desktop-bridge.ts'

const SID = 'mk-desktop' as SessionId

void ({ accepted: true } satisfies Awaited<ReturnType<DesktopBridge['request']>>)

function rpcOk(rpcId: string, value: unknown): ServerResponse {
  return { type: 'server-response', rpcId: RpcId(rpcId), result: { ok: true, value } }
}

function serverRequest(
  method: string,
  payload: unknown,
  rpcId: string = 'server-request',
): ServerRequest {
  return { type: 'server-request', rpcId: RpcId(rpcId), method, payload }
}

type SubscriptionKey = 'mux' | 'host'
type Listener = (message: unknown) => void

function fakeDesktopBridge(options: { response?: Awaited<ReturnType<DesktopBridge['request']>> } = {}): DesktopBridge & {
  requests: DesktopRequest[]
  cancellations: string[]
  cancel: (rpcId: string) => void
  close: (kind: SubscriptionKey) => void
  emit: (kind: SubscriptionKey, message: unknown) => void
  listeners: { mux?: Listener | undefined; host?: Listener | undefined }
} {
  const requests: DesktopRequest[] = []
  const cancellations: string[] = []
  const listeners: { mux?: Listener | undefined; host?: Listener | undefined } = {}
  const onClose: { mux?: (() => void) | undefined; host?: (() => void) | undefined } = {}

  return {
    requests,
    cancellations,
    listeners,
    request: async (request) => {
      requests.push(request)
      if (options.response !== undefined) return { ...options.response, rpcId: RpcId(request.rpcId) }
      return {
        type: 'server-response',
        rpcId: RpcId(request.rpcId),
        result: { ok: false, error: { code: 'internal' as const, message: 'no response configured', details: {} } },
      }
    },
    cancel: (rpcId) => { cancellations.push(rpcId) },
    subscribe: (kind, listener, close) => {
      listeners[kind] = listener
      onClose[kind] = close
      return () => {
        onClose[kind]?.()
        if (kind === 'mux') listeners.mux = undefined
        else listeners.host = undefined
      }
    },
    sendCommand: async () => undefined,
    getWindowState: async () => ({
      bounds: { x: 0, y: 0, width: 1200, height: 800 },
      sourceListVisible: true,
      inspectorVisible: false,
      sourceListWidth: 280,
      inspectorWidth: 420,
    }),
    setWindowState: async () => undefined,
    close: (kind) => { onClose[kind]?.() },
    emit: (kind, message) => { listeners[kind]?.(message) },
  }
}

function subscribedFrame(lastSeq = 0): MuxFrame {
  return { type: 'session/subscribed', sessionId: SID, lastSeq }
}

describe('DesktopApiClient', () => {
  it('sends unary calls through the desktop bridge without a network request', async () => {
    const response = rpcOk('ignored', { version: '0', cwd: '/f', attachedSessions: 0, home: '/h', canOpenPath: true })
    const bridge = fakeDesktopBridge({ response })
    const client = new DesktopApiClient(bridge)
    const result = await client.host.describe({})
    expect(result).toMatchObject({ result: { ok: true, value: { canOpenPath: true } } })
    expect(bridge.requests).toHaveLength(1)
  })

  it('cancels an active unary bridge request when aborted', async () => {
    const bridge = fakeDesktopBridge()
    const client = new DesktopApiClient(bridge)
    const abort = new AbortController()
    const pending = client.host.describe({}, abort.signal)

    abort.abort()

    await expect(pending).rejects.toThrow('This operation was aborted')
    expect(bridge.cancellations).toEqual([String(bridge.requests[0]?.rpcId)])
  })

  it('returns a client-response carrier receipt through the desktop bridge', async () => {
    const bridge = fakeDesktopBridge({ response: { accepted: true } })
    const client = new DesktopApiClient(bridge)

    await expect(client.respond({
      type: 'client-response',
      rpcId: RpcId('desktop-server-request'),
      result: { ok: true, value: null },
    })).resolves.toEqual({ accepted: true })
  })

  it('delivers accepted downlink frames in order across mux and host and calls the envelope tap', async () => {
    const bridge = fakeDesktopBridge()
    const client = new DesktopApiClient(bridge)
    const requests: string[] = []
    client.subscribeEnvelopes((batch) => {
      for (const message of batch) {
        if (message.type !== 'server-request') continue
        requests.push(String(message.rpcId) + ':' + String((message.payload as { type: string }).type))
      }
    })
    const muxIter = client.events.mux({}, new AbortController().signal)[Symbol.asyncIterator]()
    const hostIter = client.events.host({}, new AbortController().signal)[Symbol.asyncIterator]()
    const muxNext = muxIter.next()
    const hostNext = hostIter.next()
    await Promise.resolve()
    bridge.emit('mux', serverRequest('session/subscribed', { type: 'session/subscribed', sessionId: SID, lastSeq: 1 }, 'mux-1'))
    bridge.emit('host', serverRequest('host/session-status', { type: 'host/session-status', sessionId: SID, running: true }, 'host-1'))
    bridge.emit('mux', serverRequest('session/projection', {
      type: 'session/projection',
      sessionId: SID,
      key: 'todos',
      value: null,
      seq: 0,
    }, 'mux-2'))
    await expect(muxNext).resolves.toMatchObject({
      value: { rpcId: 'mux-1', payload: { type: 'session/subscribed' } },
    })
    await expect(hostNext).resolves.toMatchObject({
      value: { rpcId: 'host-1', payload: { type: 'host/session-status', running: true } },
    })
    await vi.waitFor(() => {
      expect(requests).toEqual([
        'mux-1:session/subscribed',
        'host-1:host/session-status',
        'mux-2:session/projection',
      ])
    })
  })

  it('rejects malformed downlink events without yielding or notifying envelopes', async () => {
    const bridge = fakeDesktopBridge()
    const client = new DesktopApiClient(bridge)
    const envelopeSpy = vi.fn()
    client.subscribeEnvelopes(envelopeSpy)
    const iterator = client.events.mux({}, new AbortController().signal)[Symbol.asyncIterator]()
    const pending = iterator.next()
    await Promise.resolve()
    bridge.emit('mux', { type: 'not-a-server-request' })
    bridge.emit('mux', serverRequest('session/subscribed', { type: 'bad/unknown' }, 'bad-frame'))
    await expect(Promise.race([
      pending,
      new Promise(resolve => setTimeout(() => resolve('timeout'), 20)),
    ])).resolves.toBe('timeout')
    expect(envelopeSpy).not.toHaveBeenCalled()
    bridge.emit('mux', serverRequest('session/subscribed', subscribedFrame(), 'ok-frame'))
    await expect(pending).resolves.toMatchObject({
      value: { rpcId: 'ok-frame', payload: subscribedFrame() },
    })
    expect(envelopeSpy).toHaveBeenCalledTimes(1)
  })

  it('ends the event iterable when its bridge subscription closes', async () => {
    const bridge = fakeDesktopBridge()
    const client = new DesktopApiClient(bridge)
    const iterator = client.events.mux({}, new AbortController().signal)[Symbol.asyncIterator]()
    const pending = iterator.next()
    await Promise.resolve()
    bridge.close('mux')
    await expect(pending).resolves.toEqual({ done: true, value: undefined })
  })

  it('aborts both subscriptions and unsubscribes on signal abort', async () => {
    const bridge = fakeDesktopBridge()
    const client = new DesktopApiClient(bridge)
    const abort = new AbortController()
    const muxIter = client.events.mux({}, abort.signal)[Symbol.asyncIterator]()
    const hostIter = client.events.host({}, abort.signal)[Symbol.asyncIterator]()
    const muxPending = muxIter.next()
    const hostPending = hostIter.next()
    await Promise.resolve()
    expect(bridge.listeners.mux).toBeDefined()
    expect(bridge.listeners.host).toBeDefined()
    abort.abort()
    await expect(muxPending).resolves.toEqual({ done: true, value: undefined })
    await expect(hostPending).resolves.toEqual({ done: true, value: undefined })
    expect(bridge.listeners.mux).toBeUndefined()
    expect(bridge.listeners.host).toBeUndefined()
  })
})
