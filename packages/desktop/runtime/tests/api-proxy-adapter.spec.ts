import { describe, expect, it, vi } from 'vitest'
import { RpcId, type ClientRequest, type ClientResponse } from '@deepseek-ai/dsh-host-apiproxy/api'
import { createApiProxyAdapter, createEmbeddedApiProxyAdapter } from '../src/api-proxy-adapter.ts'

function clientRequest(): ClientRequest {
  return { type: 'client-request', rpcId: RpcId('desktop-request'), method: 'host.describe', payload: {} }
}

function clientResponse(): ClientResponse {
  return { type: 'client-response', rpcId: RpcId('desktop-response'), result: { ok: true, value: null } }
}

describe('createApiProxyAdapter', () => {
  it('dispatches a client request through the supplied in-process fetch handler without a listener', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input)
      expect(request.url).toBe('http://dsh.internal/api/host.describe')
      expect(request.method).toBe('POST')
      expect(request.headers.get('content-type')).toBe('application/json')
      await expect(request.json()).resolves.toEqual(clientRequest())
      return Response.json({ type: 'server-response', rpcId: RpcId('desktop-request'), result: { ok: true, value: { cwd: '/work' } } })
    })
    const respond = vi.fn(async () => ({ accepted: true as const }))
    const adapter = createApiProxyAdapter({ respond }, { fetch })
    const controller = new AbortController()

    await expect(adapter.dispatch(clientRequest(), controller.signal)).resolves.toEqual({
      type: 'server-response',
      rpcId: 'desktop-request',
      result: { ok: true, value: { cwd: '/work' } },
    })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('forwards embedded downlinks with the frame type as method', async () => {
    const adapter = createEmbeddedApiProxyAdapter({
      respond: async () => ({ accepted: true as const }),
      events: {
        mux: () => (async function* () {
          yield { rpcId: RpcId('mux-rpc'), payload: { type: 'session/subscribed', sessionId: 'session', lastSeq: 0 } }
        })(),
      },
    } as never)

    const stream = adapter.openDownlink?.('mux', new AbortController().signal)
    if (stream === undefined) throw new Error('embedded adapter did not expose mux downlink')
    await expect(stream[Symbol.asyncIterator]().next()).resolves.toMatchObject({
      done: false,
      value: { method: 'session/subscribed', rpcId: 'mux-rpc' },
    })
  })

  it('passes client responses directly to ApiProxy and preserves its receipt', async () => {
    const respond = vi.fn(async () => ({ accepted: true as const }))
    const adapter = createApiProxyAdapter({ respond }, { fetch: vi.fn() })

    await expect(adapter.respond(clientResponse())).resolves.toEqual({ accepted: true })
    expect(respond).toHaveBeenCalledWith(clientResponse())
  })
})
