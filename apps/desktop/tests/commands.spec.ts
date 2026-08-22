import { describe, expect, it, vi } from 'vitest'
import { createDesktopCommandHandler } from '../src/commands.ts'

describe('desktop native commands', () => {
  it('executes only declared application and sender-window commands', async () => {
    const createWindow = vi.fn(async () => {})
    const reload = vi.fn()
    const toggleDevTools = vi.fn()
    const close = vi.fn()
    const quit = vi.fn()
    const window = vi.fn(() => ({ reload, toggleDevTools, close }))
    const handler = createDesktopCommandHandler({ createWindow, window, quit })

    await handler.command('window-7', { id: 'new', verb: 'window.new' })
    await handler.command('window-7', { id: 'reload', verb: 'window.reload' })
    await handler.command('window-7', { id: 'tools', verb: 'window.toggle-dev-tools' })
    await handler.command('window-7', { id: 'close', verb: 'window.close' })
    await handler.command('window-7', { id: 'quit', verb: 'application.quit' })

    expect(createWindow).toHaveBeenCalledOnce()
    expect(window).toHaveBeenCalledWith('window-7')
    expect(reload).toHaveBeenCalledOnce()
    expect(toggleDevTools).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
    expect(quit).toHaveBeenCalledOnce()
  })

  it('rejects malformed, unrecognized, and argument-bearing commands', async () => {
    const handler = createDesktopCommandHandler({
      createWindow: async () => {},
      window: () => undefined,
      quit: () => {},
    })

    await expect(handler.command('window-7', null)).rejects.toThrow('desktop native command must be an object')
    await expect(handler.command('window-7', { id: '', verb: 'window.new' })).rejects.toThrow('desktop native command requires a non-empty id')
    await expect(handler.command('window-7', { id: 'unknown', verb: 'filesystem.read' })).rejects.toThrow('desktop native command verb is not recognized')
    await expect(handler.command('window-7', { id: 'new', verb: 'window.new', args: {} })).rejects.toThrow('desktop native command window.new does not accept arguments')
  })
})
