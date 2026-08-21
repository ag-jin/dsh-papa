import { describe, expect, it, vi } from 'vitest'
import { RpcId, type ClientRequest, type ClientResponse } from '@deepseek-ai/dsh-host-apiproxy/api'
import { DesktopBridgeAuthority } from '../src/bridge.ts'
import type { DesktopResponse } from '../src/runtime.ts'

function clientRequest(rpcId: string): ClientRequest {
  return { type: 'client-request', rpcId: RpcId(rpcId), method: 'session.list', payload: {} }
}

function clientResponse(rpcId: string): ClientResponse {
  return { type: 'client-response', rpcId: RpcId(rpcId), result: { ok: true, value: null } }
}

function makeRuntime() {
  const request = vi.fn(async (_windowId: string, envelope: unknown): Promise<DesktopResponse> => {
    if ((envelope as { type?: string }).type === 'client-response') return { accepted: true }
    return { type: 'server-response', rpcId: RpcId('server-rpc'), result: { ok: true, value: null } }
  })
  const cancel = vi.fn(async () => undefined)
  return { request, cancel }
}

describe('DesktopBridgeAuthority', () => {
  it('rejects a malformed bridge request before dispatch', async () => {
    const runtime = makeRuntime()
    const authority = new DesktopBridgeAuthority(runtime)
    authority.attachWindow('window-1', () => {})

    await expect(authority.request('window-1', { type: 'client-request', rpcId: 42 })).rejects.toThrow('malformed bridge request')
    expect(runtime.request).not.toHaveBeenCalled()
  })

  it('rejects a bridge request from an unknown window', async () => {
    const runtime = makeRuntime()
    const authority = new DesktopBridgeAuthority(runtime)

    await expect(authority.request('window-2', clientRequest('rpc-1'))).rejects.toThrow('unknown window')
    expect(runtime.request).not.toHaveBeenCalled()
  })

  it('forwards a valid client-response and preserves its receipt', async () => {
    const runtime = makeRuntime()
    const authority = new DesktopBridgeAuthority(runtime)
    authority.attachWindow('window-1')

    await expect(authority.request('window-1', clientResponse('rpc-7'))).resolves.toEqual({ accepted: true })
    expect(runtime.request).toHaveBeenCalledWith('window-1', clientResponse('rpc-7'))
  })

  it('cancels an attached window request and detaches idempotently', async () => {
    const runtime = makeRuntime()
    const cleanup = vi.fn()
    const authority = new DesktopBridgeAuthority(runtime)
    const detach = authority.attachWindow('window-1', cleanup)

    await authority.cancel('window-1', 'rpc-7')
    detach()
    detach()

    expect(runtime.cancel).toHaveBeenCalledWith('window-1', 'rpc-7')
    expect(cleanup).toHaveBeenCalledTimes(1)
    await expect(authority.request('window-1', clientRequest('rpc-8'))).rejects.toThrow('unknown window')
  })
})
