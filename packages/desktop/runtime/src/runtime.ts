/** Desktop runtime lifecycle and in-process API request ownership. */

import type {
  ClientRequest,
  ClientResponse,
  RpcReceipt,
  ServerRequest,
  ServerResponse,
} from '@deepseek-ai/dsh-host-apiproxy/api'

/** Renderer-origin RPC forms accepted by the desktop preload bridge. */
export type DesktopRequest = ClientRequest | ClientResponse

/** API result forms returned to the desktop preload bridge. */
export type DesktopResponse = ServerResponse | RpcReceipt

/** Lifecycle state reported by the desktop runtime. */
export type DesktopRuntimeState = 'starting' | 'ready' | 'degraded' | 'stopping' | 'stopped'

/** Immutable state facts reported by the desktop runtime. */
export interface DesktopRuntimeSnapshot {
  /** Current lifecycle state. */
  state: DesktopRuntimeState
  /** Whether an API proxy has been acquired. */
  apiProxyReady: boolean
  /** Whether a web server is present. Desktop runtime always reports false. */
  webServerPresent: false
  /** Startup failure text when the runtime is degraded. */
  error?: string
}

/** Publishes one validated server-origin event to an attached renderer window. */
export type DesktopDownlinkPublisher = (message: ServerRequest) => void

/** Fixed server-push streams supported by the desktop bridge. */
export type DesktopDownlinkKind = 'mux' | 'host'

/** In-process subset of ApiProxy used by the desktop runtime. */
export interface ApiProxyAdapter {
  /**
   * Dispatch one client request without starting an HTTP listener.
   * @param request - Validated client request envelope.
   * @param signal - Main-process signal aborted by the fixed rpc-id cancel operation.
   * @returns Server response envelope.
   */
  dispatch(request: ClientRequest, signal: AbortSignal): Promise<ServerResponse>
  /**
   * Accept one renderer response to a pending server request.
   * @param response - Validated client response envelope.
   * @returns Existing RPC receipt for the response carrier.
   */
  respond(response: ClientResponse): Promise<RpcReceipt>
  /**
   * Open one fixed downlink for a single attached renderer window.
   * @param kind - Mux or host stream selected by the preload bridge.
   * @param signal - Main-process signal aborted when the window detaches.
   * @returns Async iterable of already-wrapped server request envelopes.
   */
  openDownlink?(kind: DesktopDownlinkKind, signal: AbortSignal): AsyncIterable<ServerRequest>
}

/** Creates the in-process services required by one desktop runtime. */
export interface DesktopRuntimeFactory {
  /**
   * Obtain the embedded API proxy. The factory must not create a web server.
   * @param service - Fixed service name requested by this runtime.
   * @returns Candidate API proxy adapter.
   */
  createContext(service: 'apiProxy'): unknown
}

/** Options for a DesktopRuntimeSupervisor. */
export interface DesktopRuntimeOptions {
  /** Factory providing the embedded API proxy. */
  createContext: DesktopRuntimeFactory['createContext']
  /** Maximum milliseconds to wait for settled abort-signaled owned work during shutdown. */
  stopTimeoutMs?: number
}

/** Runtime operations permitted to the fixed desktop bridge authority. */
export interface DesktopBridgeRuntime {
  /**
   * Process one validated desktop RPC envelope for an attached window.
   * @param windowId - Attached sender window identifier.
   * @param request - Validated request or response envelope.
   * @returns Server response envelope or response receipt.
   */
  request(windowId: string, request: DesktopRequest): Promise<DesktopResponse>
  /**
   * Abort the active request belonging to one attached window and rpc id.
   * @param windowId - Attached sender window identifier.
   * @param rpcId - Request correlation identifier.
   * @returns Completion after cancellation is recorded.
   */
  cancel(windowId: string, rpcId: string): Promise<void>
  /** Read immutable runtime state facts. */
  snapshot(): DesktopRuntimeSnapshot
}

/** True when a factory result implements the fixed in-process API proxy subset. */
function isApiProxyAdapter(value: unknown): value is ApiProxyAdapter {
  return typeof value === 'object'
    && value !== null
    && 'dispatch' in value
    && typeof value.dispatch === 'function'
    && 'respond' in value
    && typeof value.respond === 'function'
}

/** Per-window publisher and paired stream cancellation owner. */
interface AttachedDesktopWindow {
  publish: DesktopDownlinkPublisher
  downlinks: AbortController
}

/**
 * Owns embedded DSH lifecycle, attached desktop windows, and cancellation. It
 * accepts only a supplied API proxy; it never creates a DSH web listener.
 */
export class DesktopRuntimeSupervisor implements DesktopBridgeRuntime {
  private state: DesktopRuntimeState = 'stopped'
  private apiProxy: ApiProxyAdapter | undefined
  private error: string | undefined
  private readonly windows = new Map<string, AttachedDesktopWindow>()
  private readonly active = new Map<string, Map<string, AbortController>>()
  private readonly downlinkTasks = new Set<Promise<void>>()
  private readonly requestTasks = new Set<Promise<ServerResponse>>()
  private stopping: Promise<void> | undefined

  /**
   * Create a desktop runtime supervisor.
   * @param options - Factory for the embedded API proxy.
   */
  constructor(private readonly options: DesktopRuntimeOptions) {}

  /** Start the embedded runtime and acquire its API proxy. */
  async start(): Promise<void> {
    if (this.state === 'ready' || this.state === 'starting') return
    this.state = 'starting'
    this.error = undefined
    try {
      const adapter = this.options.createContext('apiProxy')
      if (!isApiProxyAdapter(adapter)) {
        throw new Error('apiProxy factory did not provide the required adapter')
      }
      this.apiProxy = adapter
      this.state = 'ready'
      for (const [windowId, attached] of this.windows) this.startDownlinks(windowId, attached)
    } catch (error) {
      this.apiProxy = undefined
      this.error = error instanceof Error ? error.message : String(error)
      this.state = 'degraded'
      throw error
    }
  }

  /**
   * Attach a desktop window and its future downlink publisher.
   * @param windowId - Unique sender window identifier.
   * @param publish - Publisher to own until detach or runtime stop.
   * @returns Idempotent detach function.
   */
  attachWindow(windowId: string, publish: DesktopDownlinkPublisher): () => void {
    this.detachWindow(windowId)
    const attached: AttachedDesktopWindow = { publish, downlinks: new AbortController() }
    this.windows.set(windowId, attached)
    this.startDownlinks(windowId, attached)
    let active = true
    return (): void => {
      if (!active) return
      active = false
      if (this.windows.get(windowId) === attached) this.detachWindow(windowId)
    }
  }

  /**
   * Process one request for an attached renderer window.
   * @param windowId - Sender window identifier.
   * @param request - Validated desktop RPC envelope.
   * @returns Server response envelope or client-response receipt.
   */
  async request(windowId: string, request: DesktopRequest): Promise<DesktopResponse> {
    if (this.state === 'stopping' || this.state === 'stopped') {
      throw new Error('desktop runtime is stopping')
    }
    if (!this.windows.has(windowId)) throw new Error('unknown window')
    const apiProxy = this.apiProxy
    if (apiProxy === undefined) throw new Error('desktop runtime is not ready')

    switch (request.type) {
      case 'client-response':
        return apiProxy.respond(request)
      case 'client-request':
        return this.dispatch(windowId, request, apiProxy)
    }
  }

  /**
   * Record an rpc-id cancellation for one attached renderer window.
   * @param windowId - Sender window identifier.
   * @param rpcId - Correlation identifier of the active client request.
   * @returns Completion once the matching request has been aborted, if any.
   */
  async cancel(windowId: string, rpcId: string): Promise<void> {
    if (!this.windows.has(windowId)) throw new Error('unknown window')
    const active = this.active.get(windowId)
    const controller = active?.get(rpcId)
    if (controller === undefined) return
    active?.delete(rpcId)
    if (active?.size === 0) this.active.delete(windowId)
    controller.abort()
  }

  /** Stop admission, abort owned work, and await active dispatches and downlinks before reporting stopped. */
  stop(): Promise<void> {
    if (this.stopping !== undefined) return this.stopping
    if (this.state === 'stopped') return Promise.resolve()

    this.state = 'stopping'
    for (const windowId of [...this.windows.keys()]) this.detachWindow(windowId)
    this.stopping = this.waitForOwnedWork().then(() => {
      this.apiProxy = undefined
      this.state = 'stopped'
    })
    return this.stopping
  }

  /**
   * Read immutable desktop runtime state facts.
   * @returns Current lifecycle and embedded transport availability facts.
   */
  snapshot(): DesktopRuntimeSnapshot {
    return {
      state: this.state,
      apiProxyReady: this.apiProxy !== undefined,
      webServerPresent: false,
      ...(this.error === undefined ? {} : { error: this.error }),
    }
  }

  private waitForOwnedWork(): Promise<void> {
    const pending = Promise.allSettled([...this.downlinkTasks, ...this.requestTasks])
    return new Promise((resolve) => {
      const timeout = setTimeout(resolve, this.options.stopTimeoutMs ?? 5_000)
      void pending.then(() => {
        clearTimeout(timeout)
        resolve()
      })
    })
  }

  private startDownlinks(windowId: string, attached: AttachedDesktopWindow): void {
    const apiProxy = this.apiProxy
    if (this.state !== 'ready' || apiProxy?.openDownlink === undefined) return
    for (const kind of ['mux', 'host'] as const) {
      const task = this.forwardDownlink(windowId, attached, kind, apiProxy)
      this.downlinkTasks.add(task)
      void task.finally(() => { this.downlinkTasks.delete(task) })
    }
  }

  private async forwardDownlink(
    windowId: string,
    attached: AttachedDesktopWindow,
    kind: DesktopDownlinkKind,
    apiProxy: ApiProxyAdapter,
  ): Promise<void> {
    const openDownlink = apiProxy.openDownlink
    if (openDownlink === undefined) return
    try {
      for await (const message of openDownlink(kind, attached.downlinks.signal)) {
        if (attached.downlinks.signal.aborted || this.windows.get(windowId) !== attached) return
        try {
          attached.publish(message)
        } catch {
          // Window destruction can race delivery through the host IPC adapter.
        }
      }
    } catch {
      // Detach aborts the source; source failures have no renderer-visible error carrier.
    }
  }

  private async dispatch(
    windowId: string,
    request: ClientRequest,
    apiProxy: ApiProxyAdapter,
  ): Promise<ServerResponse> {
    const active = this.active.get(windowId) ?? new Map<string, AbortController>()
    if (active.has(request.rpcId)) throw new Error('duplicate active request')
    const controller = new AbortController()
    active.set(request.rpcId, controller)
    this.active.set(windowId, active)
    const task = apiProxy.dispatch(request, controller.signal)
    this.requestTasks.add(task)
    try {
      return await task
    } finally {
      this.requestTasks.delete(task)
      active.delete(request.rpcId)
      if (active.size === 0) this.active.delete(windowId)
    }
  }

  private detachWindow(windowId: string): void {
    const attached = this.windows.get(windowId)
    if (attached === undefined) return
    this.windows.delete(windowId)
    attached.downlinks.abort()
    this.abortWindow(windowId)
  }

  private abortWindow(windowId: string): void {
    const active = this.active.get(windowId)
    if (active === undefined) return
    this.active.delete(windowId)
    for (const controller of active.values()) controller.abort()
  }
}
