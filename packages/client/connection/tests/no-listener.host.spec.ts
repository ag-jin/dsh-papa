import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { apply, inject, name } from '../src/index.ts'

describe('client-connection desktop composition', () => {
  it('provides the connection core without a web server', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin({ name, inject, apply })

    expect(inject).toEqual([])
    expect(ctx.connection).toBeDefined()

    await fiber.dispose()
  })

  it('installs browser transport when webServer appears after the core', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin({ name, inject, apply })
    const register = vi.fn(() => () => {})

    ctx.provide('webServer', {
      register,
      registerUpgrade: () => () => {},
    })

    await vi.waitFor(() => expect(register).toHaveBeenCalledOnce())

    await fiber.dispose()
  })
})
