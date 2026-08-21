import { describe, expect, it, vi } from 'vitest'
import { createDesktopMenu } from '../src/menu.ts'

describe('desktop native menu', () => {
  it('routes application and focused-window actions through declared main-process operations', async () => {
    const createWindow = vi.fn(async () => {})
    const reload = vi.fn()
    const toggleDevTools = vi.fn()
    const close = vi.fn()
    const quit = vi.fn()
    const menu = createDesktopMenu({
      createWindow,
      focusedWindow: () => ({ reload, toggleDevTools, close }),
      quit,
    })
    const application = menu[0]
    const view = menu[2]
    const window = menu[3]
    if (application?.submenu === undefined || view?.submenu === undefined || window?.submenu === undefined
      || !Array.isArray(application.submenu) || !Array.isArray(view.submenu) || !Array.isArray(window.submenu)) {
      throw new Error('desktop menu fixtures are incomplete')
    }

    application.submenu[0]?.click?.({} as never, undefined, {} as never)
    view.submenu[0]?.click?.({} as never, undefined, {} as never)
    view.submenu[1]?.click?.({} as never, undefined, {} as never)
    window.submenu[3]?.click?.({} as never, undefined, {} as never)
    application.submenu[2]?.click?.({} as never, undefined, {} as never)
    await vi.waitFor(() => { expect(createWindow).toHaveBeenCalledOnce() })

    expect(reload).toHaveBeenCalledOnce()
    expect(toggleDevTools).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
    expect(quit).toHaveBeenCalledOnce()
  })
})
