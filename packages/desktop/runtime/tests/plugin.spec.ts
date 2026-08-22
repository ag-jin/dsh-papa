import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { apply, inject, name } from '../src/plugin.ts'

describe('desktop runtime plugin', () => {
  it('provides a stopped supervisor over apiProxy and owns its stop disposer without webServer', async () => {
    const provide = vi.fn()
    let dispose: (() => Promise<void>) | undefined
    const effect = vi.fn((install: () => () => Promise<void>) => {
      dispose = install()
      return dispose
    })
    const ctx = {
      apiProxy: { respond: vi.fn(async () => ({ accepted: true as const })) },
      provide,
      effect,
    }

    apply(ctx as never)

    expect(name).toBe('desktop-runtime')
    expect(provide).toHaveBeenCalledWith('desktopRuntime', expect.objectContaining({
      snapshot: expect.any(Function),
      start: expect.any(Function),
      stop: expect.any(Function),
    }))
    const runtime = provide.mock.calls[0]?.[1] as { snapshot(): { state: string; webServerPresent: boolean } }
    expect(runtime.snapshot()).toEqual({ state: 'stopped', apiProxyReady: false, webServerPresent: false })
    expect(effect).toHaveBeenCalledTimes(1)

    await dispose?.()
    expect(runtime.snapshot().state).toBe('stopped')
  })

  it('mounts and disposes through a real Cordis context without a web server', async () => {
    const ctx = new Context()
    ctx.provide('apiProxy', {
      respond: async () => ({ accepted: true as const }),
      events: {
        mux: async function* () {},
        host: async function* () {},
      },
    } as never)

    const fiber = await ctx.plugin({ name, inject, apply })
    const runtime = ctx.desktopRuntime
    await runtime.start()

    expect(runtime.snapshot()).toEqual({
      state: 'ready',
      apiProxyReady: true,
      webServerPresent: false,
    })
    await fiber.dispose()
    expect(runtime.snapshot().state).toBe('stopped')
  })
})
