import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/invariant.ts'

describe('desktop-app invariant', () => {
  it('rejects a composition that exposes webServer', async () => {
    let install: ((ctx: { get(name: string): unknown }, fail: (message: string) => void) => void) | undefined
    const register = vi.fn((_name: string, candidate: typeof install) => { install = candidate; return () => {} })
    await apply({ invariants: { register } } as never)
    const fail = vi.fn()

    install?.({ get: name => name === 'webServer' ? {} : undefined }, fail)

    expect(fail).toHaveBeenCalledWith('desktop app must not compose webServer')
  })
})
