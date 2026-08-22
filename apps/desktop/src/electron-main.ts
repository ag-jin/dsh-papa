/** Electron main-process adapters for fixed packaged desktop resources. */

import { createDesktopWindowOptions, type DesktopWindowOptions } from './main.ts'
import type { DesktopProtocolHandler } from './protocol.ts'

/** Privileged custom-scheme registration exposed by Electron before app readiness. */
export interface DesktopSchemeRegistrar {
  /** Registers the only custom schemes the packaged desktop renderer may request. */
  registerSchemesAsPrivileged(schemes: Array<{ scheme: string; privileges: { standard: true; secure: true; supportFetchAPI: true } }>): void
}

/** Per-session Electron protocol registration capability. */
export interface DesktopProtocolRegistrar {
  /** Assigns a fetch-compatible handler to one protocol scheme. */
  handle(scheme: 'dsh-app' | 'dsh-client', handler: (request: { url: string }) => Promise<Response>): void
}

/** Window operations used by the secure desktop window factory. */
export interface DesktopElectronWindow {
  /** Loads one packaged renderer URL. */
  loadURL(url: 'dsh-app://renderer/index.html'): Promise<void>
  /** Registers the one first-paint visibility callback. */
  once(event: 'ready-to-show', listener: () => void): void
  /** Reveals the previously hidden window. */
  show(): void
}

/** Electron BrowserWindow factory restricted to the secure option object. */
export interface DesktopWindowFactory {
  /** Creates one desktop BrowserWindow. */
  createWindow(options: DesktopWindowOptions): DesktopElectronWindow
}

/** Fixed main-process IPC registration capability. */
export interface DesktopIpcMain {
  /** Registers one renderer-to-main handler under a declared channel. */
  handle(channel: DesktopIpcChannel, listener: (event: { sender: { id: number } }, payload?: unknown) => Promise<unknown>): void
}

/** Fixed renderer-to-main IPC channel names. */
export type DesktopIpcChannel =
  | 'dsh-desktop:request'
  | 'dsh-desktop:cancel'
  | 'dsh-desktop:command'
  | 'dsh-desktop:window-state:get'
  | 'dsh-desktop:window-state:set'

/** Main-process authority that validates request envelopes and owns cancellation. */
export interface DesktopMainBridge {
  /** Rejects a renderer sender that the desktop main process did not attach. */
  assertWindow(windowId: string): void
  /** Forwards one renderer request from its attached sender identity. */
  request(windowId: string, payload: unknown): Promise<unknown>
  /** Cancels one sender-owned active request by rpc id. */
  cancel(windowId: string, rpcId: string): Promise<void>
}

/** Declared native command consumer. */
export interface DesktopCommandHandler {
  /** Executes one declared desktop command payload for its attached renderer window. */
  command(windowId: string, payload: unknown): Promise<void>
}

/** Desktop-local window state access. */
export interface DesktopWindowStateHandler {
  /** Returns normalized desktop-local state for its attached renderer window. */
  load(windowId: string): Promise<unknown>
  /** Normalizes and persists a desktop-local state candidate for its attached renderer window. */
  save(windowId: string, payload: unknown): Promise<unknown>
}

/**
 * Registers the packaged desktop protocols before any BrowserWindow exists.
 * @param protocol - Electron's pre-ready custom-scheme registrar.
 */
export function registerDesktopSchemes(protocol: DesktopSchemeRegistrar): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'dsh-app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
    { scheme: 'dsh-client', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ])
}

/**
 * Routes both declared protocols through one containment-checked resource handler.
 * @param protocol - Electron protocol registrar for the default session.
 * @param handler - Local packaged resource handler.
 */
export function installDesktopProtocolHandlers(protocol: DesktopProtocolRegistrar, handler: DesktopProtocolHandler): void {
  const fetch = (request: { url: string }): Promise<Response> => handler.fetch(new URL(request.url))
  protocol.handle('dsh-app', fetch)
  protocol.handle('dsh-client', fetch)
}

/**
 * Installs the declared renderer-to-main IPC handlers with sender identity supplied by Electron.
 * @param ipc - Electron main-process IPC registrar.
 * @param bridge - Request and cancellation authority attached to renderer windows.
 * @param commands - Declared native command handler.
 * @param state - Desktop-local state accessor.
 */
export function installDesktopIpcHandlers(
  ipc: DesktopIpcMain,
  bridge: DesktopMainBridge,
  commands: DesktopCommandHandler,
  state: DesktopWindowStateHandler,
): void {
  const windowId = (event: { sender: { id: number } }): string => {
    const id = String(event.sender.id)
    bridge.assertWindow(id)
    return id
  }
  ipc.handle('dsh-desktop:request', (event, payload) => bridge.request(windowId(event), payload))
  ipc.handle('dsh-desktop:cancel', async (event, payload) => {
    const id = windowId(event)
    if (typeof payload !== 'string') throw new Error('desktop bridge cancel requires an rpc id')
    await bridge.cancel(id, payload)
  })
  ipc.handle('dsh-desktop:command', async (event, payload) => { await commands.command(windowId(event), payload) })
  ipc.handle('dsh-desktop:window-state:get', async event => state.load(windowId(event)))
  ipc.handle('dsh-desktop:window-state:set', async (event, payload) => state.save(windowId(event), payload))
}

/**
 * Creates and loads one secure packaged renderer window.
 * @param factory - Electron BrowserWindow factory.
 * @param preloadPath - Absolute compiled preload path.
 * @returns The created window after its packaged URL starts loading.
 */
export async function createElectronDesktopWindow(factory: DesktopWindowFactory, preloadPath: string): Promise<DesktopElectronWindow> {
  const window = factory.createWindow(createDesktopWindowOptions(preloadPath))
  window.once('ready-to-show', () => { window.show() })
  await window.loadURL('dsh-app://renderer/index.html')
  return window
}
