import { describe, expect, it, vi } from 'vitest'
import { apply, assertDesktopRuntimeInvariant } from '../src/invariant.ts'

describe('assertDesktopRuntimeInvariant', () => {
  it('accepts a ready embedded runtime with ApiProxy and no web server', () => {
    expect(() => assertDesktopRuntimeInvariant({
      state: 'ready',
      apiProxyReady: true,
      webServerPresent: false,
    })).not.toThrow()
  })

  it('rejects a ready runtime without ApiProxy or with a web server', () => {
    expect(() => assertDesktopRuntimeInvariant({
      state: 'ready',
      apiProxyReady: false,
      webServerPresent: false,
    })).toThrow('ready desktop runtime requires ApiProxy')
    expect(() => assertDesktopRuntimeInvariant({
      state: 'ready',
      apiProxyReady: true,
      webServerPresent: true,
    })).toThrow('desktop runtime must not own a web server')
  })

  it('rejects a ready composed runtime when its context has a web server', async () => {
    let install: ((ctx: { get(name: string): unknown }, fail: (message: string) => void) => void) | undefined
    const register = vi.fn((_name: string, candidate: typeof install) => { install = candidate; return () => {} })
    await apply({ invariants: { register } } as never)
    const fail = vi.fn()

    install?.({
      get: name => name === 'desktopRuntime'
        ? { snapshot: () => ({ state: 'ready', apiProxyReady: true, webServerPresent: false }) }
        : name === 'webServer' ? {} : undefined,
    }, fail)

    expect(fail).toHaveBeenCalledWith('desktop runtime must not own a web server')
  })

  it('registers the runtime invariant with the composed invariant service', async () => {
    const register = vi.fn(() => () => {})
    const ctx = { invariants: { register } }

    await apply(ctx as never)

    expect(register).toHaveBeenCalledWith('@deepseek-ai/dsh-desktop-runtime', expect.any(Function))
  })
})
