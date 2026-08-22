/** Electron process entry for the packaged listener-free DSH desktop app. */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { app, BrowserWindow, ipcMain, Menu, protocol, screen, session } from 'electron'
import { DesktopBridgeAuthority } from '@deepseek-ai/dsh-desktop-runtime'
import { createDesktopCommandHandler } from './commands.ts'
import {
  createElectronDesktopWindow,
  installDesktopIpcHandlers,
  installDesktopProtocolHandlers,
  registerDesktopSchemes,
} from './electron-main.ts'
import { createDesktopContentSecurityPolicy } from './main.ts'
import { createDesktopMenu } from './menu.ts'
import { bootPackagedDesktopRuntime, createPackagedDesktopLocations } from './packaged-desktop-boot.ts'
import { createDesktopProtocolHandler } from './protocol.ts'
import { createDesktopWindowStateStore, type DesktopWindowState } from './window-state.ts'

registerDesktopSchemes(protocol)

async function launchDesktop(): Promise<void> {
  const locations = createPackagedDesktopLocations({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
  })
  const composition = await bootPackagedDesktopRuntime(locations.boot)
  await composition.runtime.start()
  const authority = new DesktopBridgeAuthority(composition.runtime)
  let shuttingDown = false
  let state: DesktopWindowState | undefined

  app.on('before-quit', (event) => {
    if (shuttingDown) return
    shuttingDown = true
    event.preventDefault()
    void composition.dispose().catch((error) => {
      console.error('dsh-desktop: shutdown failed', error)
    }).finally(() => { app.quit() })
  })

  await app.whenReady()
  const handler = createDesktopProtocolHandler({ rendererRoot: locations.rendererRoot, catalog: composition.catalog })
  installDesktopProtocolHandlers(protocol, handler)
  session.defaultSession.webRequest.onHeadersReceived({ urls: ['dsh-app://*/*'] }, (details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [createDesktopContentSecurityPolicy()],
      },
    })
  })

  const statePath = join(app.getPath('userData'), 'window-state.json')
  const store = createDesktopWindowStateStore({
    read: () => readFile(statePath, 'utf8'),
    write: async (value) => {
      await mkdir(dirname(statePath), { recursive: true })
      await writeFile(statePath, JSON.stringify(value), 'utf8')
    },
  }, screen.getPrimaryDisplay().workArea)
  state = await store.load()

  const createWindow = async (): Promise<void> => {
    const restored = state ?? await store.load()
    const attachWindow = (nativeWindow: BrowserWindow): void => {
      const windowId = String(nativeWindow.webContents.id)
      const detachRuntime = composition.runtime.attachWindow(windowId, (message) => {
        const channel = message.method.startsWith('host/') ? 'dsh-desktop:downlink:host' : 'dsh-desktop:downlink:mux'
        nativeWindow.webContents.send(channel, message)
      })
      const detachAuthority = authority.attachWindow(windowId, detachRuntime)
      nativeWindow.once('closed', detachAuthority)
      const persist = (): void => {
        state = { ...(state ?? restored), bounds: nativeWindow.getBounds() }
        void store.save(state).then((next) => { state = next }).catch((error) => {
          console.error('dsh-desktop: failed to persist window state', error)
        })
      }
      nativeWindow.on('move', persist)
      nativeWindow.on('resize', persist)
    }
    await createElectronDesktopWindow({
      createWindow: (options) => {
        const nativeWindow = new BrowserWindow({ ...options, ...restored.bounds })
        attachWindow(nativeWindow)
        return nativeWindow
      },
    }, locations.preloadPath)
  }

  const nativeWindowFor = (windowId: string) => {
    const target = BrowserWindow.getAllWindows().find(window => String(window.webContents.id) === windowId)
    if (target === undefined) return undefined
    return {
      close: () => target.close(),
      reload: () => target.webContents.reload(),
      toggleDevTools: () => target.webContents.toggleDevTools(),
    }
  }
  const focusedWindow = () => {
    const target = BrowserWindow.getFocusedWindow()
    return target === null ? undefined : nativeWindowFor(String(target.webContents.id))
  }
  const quit = (): void => { app.quit() }
  installDesktopIpcHandlers(ipcMain, authority, createDesktopCommandHandler({
    createWindow,
    window: nativeWindowFor,
    quit,
  }), {
    load: async () => state ?? store.load(),
    save: async (_windowId, value) => {
      state = await store.save(value)
      return state
    },
  })
  Menu.setApplicationMenu(Menu.buildFromTemplate(createDesktopMenu({
    createWindow,
    focusedWindow,
    quit,
  })))

  await createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow()
  })
}

void launchDesktop().catch((error) => {
  console.error('dsh-desktop: startup failed', error)
  app.exit(1)
})
