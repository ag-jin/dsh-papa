/** Fixed desktop-native command dispatcher for sender-bound IPC requests. */

import type { DesktopCommandHandler } from './electron-main.ts'

/** Main-process window operations reachable through declared native commands. */
export interface DesktopCommandWindow {
  /** Reloads the packaged renderer. */
  reload(): void
  /** Toggles Chromium developer tools for this window. */
  toggleDevTools(): void
  /** Closes this window. */
  close(): void
}

/** Host operations owned by the desktop command dispatcher. */
export interface DesktopCommandDependencies {
  /** Creates one additional attached desktop window. */
  createWindow(): Promise<void>
  /** Returns the sender-owned native window. */
  window(windowId: string): DesktopCommandWindow | undefined
  /** Begins application shutdown. */
  quit(): void
}

type NativeCommandVerb = 'application.quit' | 'window.close' | 'window.new' | 'window.reload' | 'window.toggle-dev-tools'

interface NativeCommand {
  id: string
  verb: NativeCommandVerb
  args?: unknown
}

function readCommand(payload: unknown): NativeCommand {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('desktop native command must be an object')
  }
  const candidate = payload as Record<string, unknown>
  if (typeof candidate.id !== 'string' || candidate.id.length === 0) {
    throw new Error('desktop native command requires a non-empty id')
  }
  if (candidate.verb !== 'application.quit'
    && candidate.verb !== 'window.close'
    && candidate.verb !== 'window.new'
    && candidate.verb !== 'window.reload'
    && candidate.verb !== 'window.toggle-dev-tools') {
    throw new Error('desktop native command verb is not recognized')
  }
  return {
    id: candidate.id,
    verb: candidate.verb,
    ...(candidate.args === undefined ? {} : { args: candidate.args }),
  }
}

function requireNoArgs(command: NativeCommand): void {
  if (command.args !== undefined) throw new Error(`desktop native command ${command.verb} does not accept arguments`)
}

/**
 * Creates the fixed command table exposed through the desktop preload bridge.
 * @param dependencies - Native window and application operations owned by Electron main.
 * @returns Sender-bound handler that rejects all undeclared command payloads.
 */
export function createDesktopCommandHandler(dependencies: DesktopCommandDependencies): DesktopCommandHandler {
  return {
    async command(windowId, payload): Promise<void> {
      const command = readCommand(payload)
      requireNoArgs(command)
      switch (command.verb) {
        case 'application.quit':
          dependencies.quit()
          return
        case 'window.new':
          await dependencies.createWindow()
          return
        case 'window.close':
          dependencies.window(windowId)?.close()
          return
        case 'window.reload':
          dependencies.window(windowId)?.reload()
          return
        case 'window.toggle-dev-tools':
          dependencies.window(windowId)?.toggleDevTools()
      }
    },
  }
}
