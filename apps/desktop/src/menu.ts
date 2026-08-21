/** Native application menu for the packaged DSH desktop shell. */

import type { MenuItemConstructorOptions } from 'electron'
import type { DesktopCommandWindow } from './commands.ts'

/** Native actions the menu dispatches without widening the renderer bridge. */
export interface DesktopMenuDependencies {
  /** Creates one additional attached desktop window. */
  createWindow(): Promise<void>
  /** Returns the currently focused desktop window, when one exists. */
  focusedWindow(): DesktopCommandWindow | undefined
  /** Begins application shutdown. */
  quit(): void
}

function focused(dependencies: DesktopMenuDependencies, operation: (window: DesktopCommandWindow) => void): void {
  const window = dependencies.focusedWindow()
  if (window !== undefined) operation(window)
}

/**
 * Creates the fixed native menu for desktop-local application and window actions.
 * @param dependencies - Main-process window and application operations.
 * @returns Electron menu template without arbitrary renderer command delivery.
 */
export function createDesktopMenu(dependencies: DesktopMenuDependencies): MenuItemConstructorOptions[] {
  return [
    {
      label: 'DSH',
      submenu: [
        { label: 'New Window', accelerator: 'CommandOrControl+N', click: () => { void dependencies.createWindow() } },
        { type: 'separator' },
        { label: 'Quit DSH', accelerator: 'CommandOrControl+Q', click: () => { dependencies.quit() } },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', accelerator: 'CommandOrControl+R', click: () => { focused(dependencies, (window) => { window.reload() }) } },
        { label: 'Toggle Developer Tools', accelerator: 'Alt+CommandOrControl+I', click: () => { focused(dependencies, (window) => { window.toggleDevTools() }) } },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { label: 'Close Window', accelerator: 'CommandOrControl+W', click: () => { focused(dependencies, (window) => { window.close() }) } },
      ],
    },
  ]
}
