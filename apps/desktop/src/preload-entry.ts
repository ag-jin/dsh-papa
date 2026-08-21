/** Isolated-world installer for the fixed desktop renderer bridge. */

import { createDesktopBridge, type DesktopIpcRenderer, type DesktopPreloadBridge } from './preload.ts'

/** Minimal contextBridge capability used by the preload installer. */
export interface DesktopContextBridge {
  /** Exposes one bridge value under a fixed renderer-world name. */
  exposeInMainWorld(name: '__DSH_DESKTOP__', value: DesktopPreloadBridge): void
}

/**
 * Exposes the fixed bridge without passing through Electron objects or arbitrary IPC methods.
 * @param contextBridge - Electron isolated-world bridge adapter.
 * @param ipc - Preload-local fixed IPC adapter.
 */
export function installDesktopPreload(contextBridge: DesktopContextBridge, ipc: DesktopIpcRenderer): void {
  contextBridge.exposeInMainWorld('__DSH_DESKTOP__', createDesktopBridge(ipc))
}
