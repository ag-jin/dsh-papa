/**
 * Renderer-safe global window bridge injected by the desktop preload. Values
 * cross this boundary as JSON-compatible wire data only; the interface must
 * not import Electron, Node, fs, or callback-bearing main-process modules.
 */
import type { ClientRequest, ClientResponse, ServerResponse } from './api.ts'

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

/** One full client-origin RPC envelope the bridge forwards verbatim. */
export type DesktopRequest = ClientRequest | ClientResponse

/** One full server-origin RPC envelope returned by the bridge. */
export type DesktopResponse = ServerResponse

/** Native command payload for desktop main-process features Tasks 4/6 own. */
export interface DesktopCommand {
  /** Command id for correlation. */
  id: string
  /** Command verb owned by the desktop native producer. */
  verb: string
  /** Command-specific JSON arguments. */
  args?: JsonValue
}

/** JSON-compatible window bounds/state carried to the desktop main process. */
export interface DesktopWindowState {
  /** Window width in CSS pixels. */
  width: number
  /** Window height in CSS pixels. */
  height: number
  /** Optional window minimized state. */
  minimized?: boolean
}

/** Channel of a downlink event subscription. */
export type DesktopEventKind = 'mux' | 'host'

/**
 * Browser-visible desktop bridge. The preload installs this object on
 * `window.__DSH_DESKTOP__`; the renderer transport never bypasses it to
 * reach native APIs directly.
 */
export interface DesktopBridge {
  /** Send one client-origin RPC envelope through the preload bridge. */
  request(request: DesktopRequest): Promise<DesktopResponse>
  /**
   * Subscribe to a server-push RPC stream. The listener receives parsed JSON
   * server requests; onClose terminates the subscription from the host side.
   * @returns unsubscribe function.
   */
  subscribe(kind: DesktopEventKind, listener: (message: unknown) => void, onClose: () => void): () => void
  /** Send one native desktop command. Tasks 4/6 define the command producers. */
  sendCommand(command: DesktopCommand): Promise<void>
  /** Read current window bounds/state from the main process. */
  getWindowState(): Promise<DesktopWindowState>
  /** Request new window bounds/state from the main process. */
  setWindowState(state: DesktopWindowState): Promise<void>
}

declare global {
  interface Window {
    __DSH_DESKTOP__?: DesktopBridge
  }
}
