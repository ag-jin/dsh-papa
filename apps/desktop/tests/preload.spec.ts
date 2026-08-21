import { describe, expect, it, vi } from 'vitest'
import { createDesktopBridge } from '../src/preload.ts'

describe('desktop preload bridge', () => {
  it('exposes only declared JSON bridge operations', () => {
    const bridge = createDesktopBridge({
      invoke: vi.fn(),
      on: vi.fn(() => () => {}),
    })

    expect(Object.keys(bridge).sort()).toEqual([
      'cancel', 'getWindowState', 'request', 'sendCommand', 'setWindowState', 'subscribe',
    ])
  })
})
