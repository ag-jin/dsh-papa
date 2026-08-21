/**
 * Renderer-safe global window bridge injected by the desktop preload. Values
 * cross this boundary as JSON-compatible wire data only; the interface must
 * not import Electron, Node, fs, or callback-bearing main-process modules.
 */
import type { ClientRequest, ClientResponse, RpcReceipt, ServerResponse } from './api.ts'

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

/** One full client-origin RPC envelope the bridge forwards verbatim. */
export type DesktopRequest = ClientRequest | ClientResponse

/** One server-origin RPC envelope or client-response carrier receipt returned by the bridge. */
export type DesktopResponse = ServerResponse | RpcReceipt

/** Native command payload for desktop main-process features Tasks 4/6 own. */
export interface DesktopCommand {
  /** Command id for correlation. */
  id: string
  /** Command verb owned by the desktop native producer. */
  verb: string
  /** Command-specific JSON arguments. */
  args?: JsonValue
}

/** Desktop window geometry returned by the Electron main process. */
export interface DesktopWindowBounds {
  /** Horizontal origin in display coordinates. */
  x: number
  /** Vertical origin in display coordinates. */
  y: number
  /** Window width in CSS pixels. */
  width: number
  /** Window height in CSS pixels. */
  height: number
}

/** A renderer-provided subset of the Electron-owned window bounds. */
export interface DesktopWindowBoundsUpdate {
  /** Horizontal origin in display coordinates, when restoring a prior position. */
  x?: number
  /** Vertical origin in display coordinates, when restoring a prior position. */
  y?: number
  /** Window width in CSS pixels, when updating the visible size. */
  width?: number
  /** Window height in CSS pixels, when updating the visible size. */
  height?: number
}

/** Complete desktop-local state returned by the Electron main process. */
export interface DesktopWindowState {
  /** Normalized Electron window geometry. */
  bounds: DesktopWindowBounds
  /** Selected DSH workspace identity, when one was active. */
  activeWorkspaceId?: string
  /** Selected DSH session identity, when one was active. */
  activeSessionId?: string
  /** Whether the source list is visible. */
  sourceListVisible: boolean
  /** Whether the contextual inspector is visible. */
  inspectorVisible: boolean
  /** Persisted source-list width in CSS pixels. */
  sourceListWidth: number
  /** Persisted inspector width in CSS pixels. */
  inspectorWidth: number
}

/** Renderer-provided desktop-local state fields normalized by the Electron main process. */
export interface DesktopWindowStateUpdate {
  /** Window geometry to restore or update. */
  bounds?: DesktopWindowBoundsUpdate
  /** Selected DSH workspace identity, when one was active. */
  activeWorkspaceId?: string
  /** Selected DSH session identity, when one was active. */
  activeSessionId?: string
  /** Whether the source list is visible. */
  sourceListVisible?: boolean
  /** Whether the contextual inspector is visible. */
  inspectorVisible?: boolean
  /** Persisted source-list width in CSS pixels. */
  sourceListWidth?: number
  /** Persisted inspector width in CSS pixels. */
  inspectorWidth?: number
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
   * Signals cancellation for an active request without exposing AbortSignal across preload.
   * @param rpcId - JSON-safe request correlation id to cancel.
   */
  cancel(rpcId: string): void
  /**
   * Subscribe to a server-push RPC stream. The listener receives parsed JSON
   * server requests; onClose terminates the subscription from the host side.
   * @returns unsubscribe function.
   */
  subscribe(kind: DesktopEventKind, listener: (message: unknown) => void, onClose: () => void): () => void
  /** Send one native desktop command. Tasks 4/6 define the command producers. */
  sendCommand(command: DesktopCommand): Promise<void>
  /** Read the current normalized desktop-local state from the main process. */
  getWindowState(): Promise<DesktopWindowState>
  /** Request a normalized desktop-local state update from the main process. */
  setWindowState(state: DesktopWindowStateUpdate): Promise<void>
}

declare global {
  interface Window {
    __DSH_DESKTOP__?: DesktopBridge
  }
}
