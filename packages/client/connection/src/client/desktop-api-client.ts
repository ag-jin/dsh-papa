/** DesktopApiClient: renderer-safe bridge carrier using global DesktopBridge. */

import type { HostFrame, MuxFrame, RpcRequest, ServerRequest } from './api.ts'
import { AbstractApiClient } from './api.ts'
import type { DesktopBridge, DesktopRequest } from './desktop-bridge.ts'
import { hostFrameSchema, muxFrameSchema } from '@deepseek-ai/dsh-host-apiproxy/api/events.schema'
import { serverRequestSchema } from '@deepseek-ai/dsh-host-apiproxy/api/rpc.schema'

type Channel = 'mux' | 'host'
type SocketItem<F> = { kind: 'frame'; envelope: RpcRequest<F> } | { kind: 'end' }
type Parser<F> = { parse(value: unknown): F }

/** Browser platform subclass: unary/respond and streams use the preload bridge. */
export class DesktopApiClient extends AbstractApiClient {
  /** Map the AbstractApiClient fetch hop to the bridge envelope. */
  protected override doFetch(_input: URL, init?: RequestInit): Promise<Response> {
    if (typeof init?.body !== 'string') {
      return Promise.reject(new Error('desktop bridge fetch requires a JSON request body'))
    }
    const message = JSON.parse(init.body) as DesktopRequest
    const signal = init.signal
    if (signal?.aborted) return Promise.reject(abortError(signal))
    return new Promise((resolve, reject) => {
      const onAbort = (): void => { reject(abortError(signal)) }
      signal?.addEventListener('abort', onAbort, { once: true })
      this.bridge.request(message).then(
        (response) => {
          signal?.removeEventListener('abort', onAbort)
          resolve(new Response(JSON.stringify(response), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }))
        },
        (error) => {
          signal?.removeEventListener('abort', onAbort)
          reject(error)
        },
      )
    })
  }

  /**
   * Opens the mux downlink using the preload bridge subscription.
   * @param _payload - unused mux subscription request payload.
   * @param signal - abort signal that closes and unsubscribes the downlink.
   * @param onOpen - optional readiness callback invoked after subscription.
   * @returns an async iterable of validated mux request envelopes.
   */
  override openMux(
    _payload: Parameters<AbstractApiClient['events']['mux']>[0]['payload'],
    signal: AbortSignal,
    onOpen?: () => void,
  ): AsyncIterable<RpcRequest<MuxFrame>> {
    return this.readBridge('mux', signal, muxFrameSchema, onOpen)
  }

  /**
   * Opens the host downlink using the preload bridge subscription.
   * @param _payload - unused host subscription request payload.
   * @param signal - abort signal that closes and unsubscribes the downlink.
   * @param onOpen - optional readiness callback invoked after subscription.
   * @returns an async iterable of validated host request envelopes.
   */
  override openHost(
    _payload: Parameters<AbstractApiClient['events']['host']>[0]['payload'],
    signal: AbortSignal,
    onOpen?: () => void,
  ): AsyncIterable<RpcRequest<HostFrame>> {
    return this.readBridge('host', signal, hostFrameSchema, onOpen)
  }

  private async *readBridge<F extends MuxFrame | HostFrame>(
    kind: Channel,
    signal: AbortSignal,
    frameSchema: Parser<F>,
    onOpen?: () => void,
  ): AsyncGenerator<RpcRequest<F>> {
    const inbox: SocketItem<F>[] = []
    let wake: (() => void) | undefined
    let ended = false
    const enqueue = (item: SocketItem<F>): void => {
      inbox.push(item)
      const resolve = wake
      wake = undefined
      resolve?.()
    }
    const end = (): void => {
      if (ended) return
      ended = true
      enqueue({ kind: 'end' })
    }
    const handleMessage = (message: unknown): void => {
      if (ended) return
      let full: ServerRequest
      let frame: F
      try {
        full = serverRequestSchema.parse(message)
        frame = frameSchema.parse(full.payload)
      } catch (error) {
        console.error(`[client-connection] dropping malformed desktop frame on ${kind}:`, error)
        return
      }
      this.onEnvelope(full)
      enqueue({ kind: 'frame', envelope: { rpcId: full.rpcId, payload: frame } })
    }
    const handleClose = end
    const handleAbort = end
    const unsubscribe = this.bridge.subscribe(kind, handleMessage, handleClose)
    onOpen?.()
    signal.addEventListener('abort', handleAbort, { once: true })
    if (signal.aborted) handleAbort()
    try {
      while (true) {
        while (inbox.length > 0) {
          const item = inbox.shift() as SocketItem<F>
          if (item.kind === 'end') return
          yield item.envelope
        }
        await new Promise<void>((resolve) => { wake = resolve })
      }
    } finally {
      signal.removeEventListener('abort', handleAbort)
      unsubscribe()
    }
  }

  constructor(private readonly bridge: DesktopBridge) {
    super()
  }
}

/** Mirror fetch's abort rejection: the signal's reason when present, else an AbortError. */
function abortError(signal: AbortSignal): Error {
  const reason: unknown = signal.reason
  if (reason instanceof Error) return reason
  if (typeof reason === 'string') return new Error(reason)
  return new Error('This operation was aborted')
}
