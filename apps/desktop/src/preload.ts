/** Fixed JSON-only renderer bridge used by the Electron preload entry. */

/** JSON-compatible data accepted by fixed desktop IPC operations. */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

/** Narrow preload-facing IPC operations. */
export type DesktopIpcChannel =
  | 'dsh-desktop:request'
  | 'dsh-desktop:cancel'
  | 'dsh-desktop:command'
  | 'dsh-desktop:window-state:get'
  | 'dsh-desktop:window-state:set'

/** Electron IPC adapter with only the operations the bridge requires. */
export interface DesktopIpcRenderer {
  /** Invoke one fixed unary main-process operation. */
  invoke(channel: DesktopIpcChannel, payload?: JsonValue): Promise<JsonValue>
  /** Subscribe to one fixed main-to-renderer downlink channel. */
  on(channel: 'dsh-desktop:downlink:mux' | 'dsh-desktop:downlink:host', listener: (message: JsonValue) => void): () => void
}

/** Renderer-visible methods installed by the Electron preload entry. */
export interface DesktopPreloadBridge {
  /** Send one serialized DSH RPC carrier through the main process. */
  request(request: JsonValue): Promise<JsonValue>
  /** Record a best-effort cancellation for a serialized rpc id. */
  cancel(rpcId: string): void
  /** Subscribe to a fixed DSH server-push stream. */
  subscribe(kind: 'mux' | 'host', listener: (message: JsonValue) => void, onClose: () => void): () => void
  /** Send one declared native command. */
  sendCommand(command: JsonValue): Promise<void>
  /** Read the desktop-owned window state. */
  getWindowState(): Promise<JsonValue>
  /** Persist validated desktop-owned window state. */
  setWindowState(state: JsonValue): Promise<void>
}

function serialize<T extends JsonValue>(value: T): T {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) throw new Error('desktop bridge payload must be JSON-compatible')
  return JSON.parse(serialized) as T
}

/**
 * Creates the fixed renderer bridge without exposing the underlying Electron IPC object.
 * @param ipc - Preload-local IPC adapter with fixed operation names.
 * @returns JSON-only operations safe to expose in the isolated renderer world.
 */
export function createDesktopBridge(ipc: DesktopIpcRenderer): DesktopPreloadBridge {
  const bridge: DesktopPreloadBridge = {
    request: request => ipc.invoke('dsh-desktop:request', serialize(request)),
    cancel: (rpcId) => {
      void ipc.invoke('dsh-desktop:cancel', serialize(rpcId)).catch(() => {
        // Cancellation is best effort after the renderer has stopped waiting for the response.
      })
    },
    subscribe: (kind, listener, onClose) => {
      const channel = kind === 'mux' ? 'dsh-desktop:downlink:mux' : 'dsh-desktop:downlink:host'
      const unsubscribe = ipc.on(channel, (message) => { listener(serialize(message)) })
      return (): void => {
        unsubscribe()
        onClose()
      }
    },
    sendCommand: async (command) => { await ipc.invoke('dsh-desktop:command', serialize(command)) },
    getWindowState: () => ipc.invoke('dsh-desktop:window-state:get'),
    setWindowState: async (state) => { await ipc.invoke('dsh-desktop:window-state:set', serialize(state)) },
  }
  return Object.freeze(bridge)
}
