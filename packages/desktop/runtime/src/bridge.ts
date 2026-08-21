/** Fixed main-process authority for renderer-visible desktop bridge operations. */

import {
  clientRequestSchema,
  clientResponseSchema,
} from '@deepseek-ai/dsh-host-apiproxy/api/rpc.schema'
import type { DesktopBridgeRuntime, DesktopRequest, DesktopResponse } from './runtime.ts'

/** Runtime operations the desktop bridge authority may invoke. */
export interface DesktopBridgeAuthorityRuntime extends Pick<DesktopBridgeRuntime, 'request' | 'cancel'> {}

/** Parse one JSON wire value as either legal desktop request carrier. */
function parseDesktopRequest(value: unknown): DesktopRequest | undefined {
  const clientRequest = clientRequestSchema.safeParse(value)
  if (clientRequest.success) return clientRequest.data
  const clientResponse = clientResponseSchema.safeParse(value)
  if (clientResponse.success) return clientResponse.data
  return undefined
}

/**
 * Validates known renderer windows and fixed request/cancel operations before
 * passing JSON RPC envelopes to the embedded desktop runtime.
 */
export class DesktopBridgeAuthority {
  private readonly windows = new Map<string, () => void>()

  /**
   * Create a desktop bridge authority.
   * @param runtime - Embedded runtime that owns request execution and cancellation.
   */
  constructor(private readonly runtime: DesktopBridgeAuthorityRuntime) {}

  /**
   * Allow one renderer window to use the fixed bridge operations.
   * @param windowId - Renderer sender identifier supplied by the main process.
   * @param onDetach - Optional cleanup called once when this authority detaches the window.
   * @returns Idempotent cleanup that revokes the sender identity.
   */
  attachWindow(windowId: string, onDetach: () => void = (): void => {}): () => void {
    this.windows.get(windowId)?.()
    let attached = true
    const detach = (): void => {
      if (!attached) return
      attached = false
      this.windows.delete(windowId)
      onDetach()
    }
    this.windows.set(windowId, detach)
    return detach
  }

  /**
   * Reject an Electron sender identity that is not attached to this authority.
   * @param windowId - Renderer sender identifier supplied by the main process.
   */
  assertWindow(windowId: string): void {
    this.requireWindow(windowId)
  }

  /**
   * Validate and dispatch a desktop RPC envelope from an attached sender.
   * @param windowId - Renderer sender identifier supplied by the main process.
   * @param message - JSON wire value supplied by the preload bridge.
   * @returns API server response or existing client-response receipt.
   */
  async request(windowId: string, message: unknown): Promise<DesktopResponse> {
    this.assertWindow(windowId)
    const request = parseDesktopRequest(message)
    if (request === undefined) throw new Error('malformed bridge request')
    return this.runtime.request(windowId, request)
  }

  /**
   * Forward a fixed rpc-id cancellation from an attached renderer sender.
   * @param windowId - Renderer sender identifier supplied by the main process.
   * @param rpcId - JSON-safe correlation identifier of an active request.
   * @returns Completion after runtime cancellation is recorded.
   */
  async cancel(windowId: string, rpcId: string): Promise<void> {
    this.assertWindow(windowId)
    await this.runtime.cancel(windowId, rpcId)
  }

  private requireWindow(windowId: string): void {
    if (!this.windows.has(windowId)) throw new Error('unknown window')
  }
}
