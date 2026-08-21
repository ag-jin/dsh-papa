import { describe, expect, it, vi } from 'vitest'
import { installDesktopPreload } from '../src/preload-entry.ts'

describe('desktop preload entry', () => {
  it('exposes the fixed bridge through exactly one isolated-world key', () => {
    const exposeInMainWorld = vi.fn()
    installDesktopPreload({ exposeInMainWorld }, {
      invoke: vi.fn(async () => null),
      on: vi.fn(() => () => {}),
    })

    expect(exposeInMainWorld).toHaveBeenCalledOnce()
    expect(exposeInMainWorld.mock.calls[0]?.[0]).toBe('__DSH_DESKTOP__')
    expect(Object.keys(exposeInMainWorld.mock.calls[0]?.[1] as object).sort()).toEqual([
      'cancel', 'getWindowState', 'request', 'sendCommand', 'setWindowState', 'subscribe',
    ])
  })
})
