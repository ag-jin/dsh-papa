import { describe, expect, it } from 'vitest'
import { createDesktopContentSecurityPolicy, createDesktopWindowOptions } from '../src/main.ts'

describe('desktop main security', () => {
  it('creates a sandboxed isolated window with a packaged preload', () => {
    expect(createDesktopWindowOptions('/app/preload.cjs')).toMatchObject({
      show: false,
      webPreferences: {
        preload: '/app/preload.cjs',
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    })
  })

  it('permits packaged bootstrap execution without renderer network access', () => {
    expect(createDesktopContentSecurityPolicy()).toBe(
      "default-src 'self'; connect-src 'none'; img-src 'self' data:; script-src 'self' dsh-client: 'unsafe-inline' 'unsafe-eval'; style-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    )
  })
})
