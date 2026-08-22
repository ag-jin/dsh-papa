/** Adapts ApiProxy to the no-listener desktop runtime request interface. */

import {
  RpcId,
  toFetchHandler,
  type ApiProxy,
  type ClientRequest,
  type ClientResponse,
  type RpcReceipt,
  type ServerRequest,
  type ServerResponse,
} from '@deepseek-ai/dsh-host-apiproxy'
import { randomUUID } from 'node:crypto'
import { serverResponseSchema } from '@deepseek-ai/dsh-host-apiproxy/api/rpc.schema'
import type { ApiProxyAdapter } from './runtime.ts'

/** Pure fetch carrier returned by ApiProxy's existing host adapter. */
export interface DesktopApiFetchHandler {
  /**
   * Dispatch one in-process request without opening a network listener.
   * @param input - Request or URL accepted by the standard Fetch API.
   * @param init - Optional Fetch request options.
   * @returns API response.
   */
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}

/** Minimal ApiProxy operation required for the client-response carrier. */
export interface DesktopApiResponder {
  /**
   * Consume a renderer response to an outstanding server request.
   * @param response - Validated client response envelope.
   * @returns Existing RPC receipt.
   */
  respond(response: ClientResponse): Promise<RpcReceipt>
}

/**
 * Build the desktop request adapter over a supplied pure fetch carrier.
 * @param api - ApiProxy response consumer.
 * @param handler - In-process Fetch carrier that never owns a listener.
 * @returns Adapter accepted by DesktopRuntimeSupervisor.
 */
export function createApiProxyAdapter(
  api: DesktopApiResponder,
  handler: DesktopApiFetchHandler,
): ApiProxyAdapter {
  return {
    async dispatch(request: ClientRequest, signal: AbortSignal): Promise<ServerResponse> {
      const response = await handler.fetch(new Request('http://dsh.internal/api/' + request.method, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
        signal,
      }))
      const parsed = serverResponseSchema.safeParse(await response.json())
      if (!parsed.success) throw new Error('embedded ApiProxy returned malformed server response')
      return parsed.data
    },
    respond: response => api.respond(response),
  }
}

/** Open one host event source as full desktop bridge envelopes. */
async function* openEmbeddedDownlink(
  api: ApiProxy,
  kind: 'mux' | 'host',
  signal: AbortSignal,
): AsyncGenerator<ServerRequest> {
  const stream = kind === 'mux'
    ? api.events.mux({ rpcId: RpcId(randomUUID()), payload: {} }, signal)
    : api.events.host({ rpcId: RpcId(randomUUID()), payload: {} }, signal)
  for await (const frame of stream) {
    yield {
      type: 'server-request',
      rpcId: frame.rpcId,
      method: frame.payload.type,
      payload: frame.payload,
    }
  }
}

/**
 * Build the desktop request adapter directly from an active embedded ApiProxy.
 * @param api - Composed ApiProxy service.
 * @returns Adapter using the existing no-listener fetch handler.
 */
export function createEmbeddedApiProxyAdapter(api: ApiProxy): ApiProxyAdapter {
  return {
    ...createApiProxyAdapter(api, toFetchHandler(api)),
    openDownlink: (kind, signal) => openEmbeddedDownlink(api, kind, signal),
  }
}
