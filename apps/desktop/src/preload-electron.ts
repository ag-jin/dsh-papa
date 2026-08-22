/** Electron preload runner that installs the fixed JSON bridge. */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { installDesktopPreload } from './preload-entry.ts'
import type { JsonValue } from './preload.ts'

installDesktopPreload(contextBridge, {
  invoke: async (channel, payload) => (await ipcRenderer.invoke(channel, payload)) as JsonValue,
  on: (channel, listener) => {
    const receiver = (_event: IpcRendererEvent, message: unknown): void => { listener(message as JsonValue) }
    ipcRenderer.on(channel, receiver)
    return (): void => { ipcRenderer.removeListener(channel, receiver) }
  },
})
