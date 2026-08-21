import { describe, expect, it, vi } from 'vitest'
import { RpcId, type ClientRequest } from '@deepseek-ai/dsh-host-apiproxy/api'
import { DesktopRuntimeSupervisor } from '../src/runtime.ts'

function envelope(rpcId: string): ClientRequest {
  return { type: 'client-request', rpcId: RpcId(rpcId), method: 'session.list', payload: {} }
}

function makeOptions() {
  const provided: string[] = []
  const dispatch = vi.fn(async (request: unknown) => ({ type: 'server-response', rpcId: 'server', result: { ok: true, value: request } }))
  const respond = vi.fn(async () => ({ accepted: true }))
  const options = {
    createContext(plugin: string): unknown {
      provided.push(plugin)
      if (plugin === 'apiProxy') return { dispatch, respond }
      return {}
    },
  }
  return { options, provided, dispatch }
}

async function readyRuntime() {
  const runtime = new DesktopRuntimeSupervisor(makeOptions().options)
  await runtime.start()
  return runtime
}

describe('DesktopRuntimeSupervisor', () => {
  it('starts the desktop composition without providing a web server', async () => {
    const { options, provided } = makeOptions()
    const runtime = new DesktopRuntimeSupervisor(options)

    await runtime.start()

    expect(runtime.snapshot().state).toBe('ready')
    expect(provided).toEqual(['apiProxy'])
    expect(runtime.snapshot().webServerPresent).toBe(false)
  })

  it('rejects new bridge requests after stopping starts', async () => {
    const runtime = await readyRuntime()
    const stopping = runtime.stop()

    await expect(runtime.request('window-1', envelope('rpc-1'))).rejects.toThrow('desktop runtime is stopping')
    await stopping
    expect(runtime.snapshot().state).toBe('stopped')
  })

  it('routes requests through attached windows and stops routing after detach', async () => {
    const { options, dispatch } = makeOptions()
    const runtime = new DesktopRuntimeSupervisor(options)
    await runtime.start()
    const detach = runtime.attachWindow('window-1', vi.fn())

    await runtime.request('window-1', envelope('rpc-1'))

    expect(dispatch).toHaveBeenCalledWith(envelope('rpc-1'), expect.any(AbortSignal))
    detach()
    detach()
    await expect(runtime.request('window-1', envelope('rpc-2'))).rejects.toThrow('unknown window')
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  it('forwards both downlinks to an attached window and aborts them on detach', async () => {
    const published: unknown[] = []
    const aborted: string[] = []
    const openDownlink = vi.fn((kind: 'mux' | 'host', signal: AbortSignal) => (async function* () {
      signal.addEventListener('abort', () => { aborted.push(kind) }, { once: true })
      yield {
        type: 'server-request' as const,
        rpcId: RpcId(kind + '-rpc'),
        method: kind === 'mux' ? 'session/subscribed' : 'host/session-status',
        payload: kind === 'mux'
          ? { type: 'session/subscribed', sessionId: 'desktop-session', lastSeq: 0 }
          : { type: 'host/session-status', sessionId: 'desktop-session', running: false },
      }
      await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
    })())
    const runtime = new DesktopRuntimeSupervisor({
      createContext: plugin => plugin === 'apiProxy' ? {
        dispatch: async () => ({ type: 'server-response', rpcId: RpcId('request'), result: { ok: true, value: null } }),
        respond: async () => ({ accepted: true }),
        openDownlink,
      } : {},
    })
    await runtime.start()
    const detach = runtime.attachWindow('window-1', (message) => { published.push(message) })

    await vi.waitFor(() => expect(published).toHaveLength(2))
    detach()

    expect(published.map(message => (message as { method: string }).method).sort())
      .toEqual(['host/session-status', 'session/subscribed'])
    expect(aborted.sort()).toEqual(['host', 'mux'])
  })

  it('waits for owned downlinks to finish before reporting stopped', async () => {
    const aborted: string[] = []
    const settled: string[] = []
    let release: (() => void) | undefined
    const done = new Promise<void>((resolve) => { release = resolve })
    const runtime = new DesktopRuntimeSupervisor({
      createContext: plugin => plugin === 'apiProxy' ? {
        dispatch: async () => ({ type: 'server-response', rpcId: RpcId('request'), result: { ok: true, value: null } }),
        respond: async () => ({ accepted: true }),
        openDownlink: (kind: 'mux' | 'host', signal: AbortSignal) => (async function* () {
          signal.addEventListener('abort', () => { aborted.push(kind) }, { once: true })
          await done
          settled.push(kind)
        })(),
      } : {},
    })
    await runtime.start()
    runtime.attachWindow('window-1', () => {})
    const stopping = runtime.stop()

    await vi.waitFor(() => expect(aborted).toHaveLength(2))
    expect(runtime.snapshot().state).toBe('stopping')
    release?.()
    await stopping

    expect(settled.sort()).toEqual(['host', 'mux'])
    expect(runtime.snapshot().state).toBe('stopped')
  })

  it('waits for active unary dispatches to settle after aborting them', async () => {
    let release: ((response: { type: 'server-response'; rpcId: ReturnType<typeof RpcId>; result: { ok: true; value: null } }) => void) | undefined
    const response = new Promise<{ type: 'server-response'; rpcId: ReturnType<typeof RpcId>; result: { ok: true; value: null } }>((resolve) => { release = resolve })
    const dispatch = vi.fn((_request: unknown, signal: AbortSignal) => {
      signal.addEventListener('abort', () => {}, { once: true })
      return response
    })
    const runtime = new DesktopRuntimeSupervisor({
      createContext: plugin => plugin === 'apiProxy' ? { dispatch, respond: async () => ({ accepted: true }) } : {},
    })
    await runtime.start()
    runtime.attachWindow('window-1', () => {})
    const pending = runtime.request('window-1', envelope('rpc-1'))

    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledOnce())
    const stopping = runtime.stop()
    await Promise.resolve()
    await Promise.resolve()

    expect(runtime.snapshot().state).toBe('stopping')
    release?.({ type: 'server-response', rpcId: RpcId('rpc-1'), result: { ok: true, value: null } })
    await pending
    await stopping
    expect(runtime.snapshot().state).toBe('stopped')
  })

  it('treats an abort-rejected unary dispatch as settled shutdown work', async () => {
    vi.useFakeTimers()
    try {
      const dispatch = vi.fn((_request: unknown, signal: AbortSignal) => new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => { reject(new Error('cancelled')) }, { once: true })
      }))
      const runtime = new DesktopRuntimeSupervisor({
        stopTimeoutMs: 25,
        createContext: plugin => plugin === 'apiProxy' ? { dispatch, respond: async () => ({ accepted: true }) } : {},
      })
      await runtime.start()
      runtime.attachWindow('window-1', () => {})
      const pending = runtime.request('window-1', envelope('rpc-1'))
      const rejected = pending.then(
        () => new Error('request resolved after shutdown'),
        (error: unknown) => error as Error,
      )
      await vi.waitFor(() => expect(dispatch).toHaveBeenCalledOnce())
      const stopping = runtime.stop()
      let stopped = false
      void stopping.then(() => { stopped = true })

      await expect(rejected).resolves.toMatchObject({ message: 'cancelled' })
      await Promise.resolve()
      await Promise.resolve()

      expect(stopped).toBe(true)
      expect(runtime.snapshot().state).toBe('stopped')
    } finally {
      await vi.runAllTimersAsync()
      vi.useRealTimers()
    }
  })

  it('bounds shutdown when a downlink ignores abort', async () => {
    vi.useFakeTimers()
    try {
      const never = new Promise<void>(() => {})
      const runtime = new DesktopRuntimeSupervisor({
        stopTimeoutMs: 25,
        createContext: plugin => plugin === 'apiProxy' ? {
          dispatch: async () => ({ type: 'server-response', rpcId: RpcId('request'), result: { ok: true, value: null } }),
          respond: async () => ({ accepted: true }),
          openDownlink: () => (async function* () { await never })(),
        } : {},
      })
      await runtime.start()
      runtime.attachWindow('window-1', () => {})
      const stopping = runtime.stop()

      await vi.advanceTimersByTimeAsync(25)
      await stopping

      expect(runtime.snapshot().state).toBe('stopped')
    } finally {
      vi.useRealTimers()
    }
  })

  it('aborts an active request exactly once by its window and rpcId', async () => {
    let aborts = 0
    const dispatch = vi.fn((_request: unknown, signal: AbortSignal) => new Promise<never>((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        aborts += 1
        reject(new Error('cancelled'))
      }, { once: true })
    }))
    const runtime = new DesktopRuntimeSupervisor({
      createContext: plugin => plugin === 'apiProxy' ? { dispatch, respond: async () => ({ accepted: true }) } : {},
    })
    await runtime.start()
    runtime.attachWindow('window-1', vi.fn())
    const pending = runtime.request('window-1', envelope('rpc-1'))
    const rejected = pending.then(
      () => new Error('request resolved after cancellation'),
      (error: unknown) => error as Error,
    )

    await runtime.cancel('window-1', 'rpc-1')
    await runtime.cancel('window-1', 'rpc-1')

    expect((await rejected).message).toBe('cancelled')
    expect(aborts).toBe(1)
  })
})
