import { describe, expect, it, vi } from 'vitest'
import { createElectronDesktopWindow, installDesktopIpcHandlers, installDesktopProtocolHandlers, registerDesktopSchemes } from '../src/electron-main.ts'

describe('Electron desktop main adapter', () => {
  it('registers only secure fetch-capable packaged schemes and routes both through the local handler', async () => {
    const registerSchemesAsPrivileged = vi.fn()
    const handle = vi.fn()
    registerDesktopSchemes({ registerSchemesAsPrivileged })
    installDesktopProtocolHandlers({ handle }, { fetch: vi.fn(async () => new Response()) })

    expect(registerSchemesAsPrivileged).toHaveBeenCalledWith([
      { scheme: 'dsh-app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
      { scheme: 'dsh-client', privileges: { standard: true, secure: true, supportFetchAPI: true } },
    ])
    const schemes = handle.mock.calls.map((call) => {
      const [scheme] = call as [string, unknown]
      return scheme
    }).sort()
    expect(schemes).toEqual(['dsh-app', 'dsh-client'])
  })

  it('installs only fixed sender-bound IPC handlers', async () => {
    const handlers = new Map<string, (event: { sender: { id: number } }, payload?: unknown) => Promise<unknown>>()
    const assertWindow = vi.fn()
    const request = vi.fn(async () => ({ accepted: true }))
    const cancel = vi.fn(async () => {})
    const command = vi.fn(async () => {})
    const load = vi.fn(async () => ({ bounds: { x: 0, y: 0, width: 640, height: 480 } }))
    const save = vi.fn(async (_windowId: string, value) => value)

    installDesktopIpcHandlers(
      { handle: (channel, listener) => { handlers.set(channel, listener) } },
      { assertWindow, request, cancel },
      { command },
      { load, save },
    )

    expect([...handlers.keys()].sort()).toEqual([
      'dsh-desktop:cancel', 'dsh-desktop:command', 'dsh-desktop:request', 'dsh-desktop:window-state:get', 'dsh-desktop:window-state:set',
    ])
    await expect(handlers.get('dsh-desktop:request')?.({ sender: { id: 7 } }, { type: 'client-request' })).resolves.toEqual({ accepted: true })
    expect(request).toHaveBeenCalledWith('7', { type: 'client-request' })
    await expect(handlers.get('dsh-desktop:cancel')?.({ sender: { id: 7 } }, 42)).rejects.toThrow('desktop bridge cancel requires an rpc id')
    await expect(handlers.get('dsh-desktop:command')?.({ sender: { id: 7 } }, { kind: 'new-window' })).resolves.toBeUndefined()
    expect(command).toHaveBeenCalledWith('7', { kind: 'new-window' })
    await expect(handlers.get('dsh-desktop:window-state:get')?.({ sender: { id: 7 } })).resolves.toEqual({ bounds: { x: 0, y: 0, width: 640, height: 480 } })
    expect(load).toHaveBeenCalledWith('7')
    await expect(handlers.get('dsh-desktop:window-state:set')?.({ sender: { id: 7 } }, { sourceListWidth: 9999 })).resolves.toEqual({ sourceListWidth: 9999 })
    expect(save).toHaveBeenCalledWith('7', { sourceListWidth: 9999 })
    expect(assertWindow).toHaveBeenCalledWith('7')
  })

  it('constructs and attaches a window through the factory before navigation begins', async () => {
    const order: string[] = []
    const window = {
      loadURL: vi.fn(async () => { order.push('load') }),
      once: vi.fn(),
      show: vi.fn(),
    }

    await createElectronDesktopWindow({
      createWindow: () => {
        order.push('factory')
        order.push('attached')
        return window
      },
    }, '/app/preload.cjs')

    expect(order).toEqual(['factory', 'attached', 'load'])
  })

  it('loads only the packaged renderer URL before revealing a secure window', async () => {
    const loadURL = vi.fn(async () => {})
    const once = vi.fn((_event: string, listener: () => void) => { listener() })
    const show = vi.fn()
    const createWindow = vi.fn(() => ({ loadURL, once, show }))

    await createElectronDesktopWindow({ createWindow }, '/app/preload.cjs')

    expect(createWindow).toHaveBeenCalledWith(expect.objectContaining({
      webPreferences: expect.objectContaining({ preload: '/app/preload.cjs', contextIsolation: true, nodeIntegration: false, sandbox: true }),
    }))
    expect(loadURL).toHaveBeenCalledWith('dsh-app://renderer/index.html')
    expect(show).toHaveBeenCalledOnce()
  })
})
