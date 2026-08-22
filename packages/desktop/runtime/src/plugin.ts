/** Cordis provider for the no-listener desktop runtime supervisor. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-apiproxy'
import { createEmbeddedApiProxyAdapter } from './api-proxy-adapter.ts'
import { DesktopRuntimeSupervisor } from './runtime.ts'

/** Stable Cordis plugin identifier for the embedded desktop runtime. */
export const name = 'desktop-runtime'

/** Services required before the desktop runtime provider can mount. */
export const inject = ['apiProxy']

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** No-listener desktop runtime available to the Electron main process. */
    desktopRuntime: DesktopRuntimeSupervisor
  }
}

/** Desktop runtime shutdown configuration. */
export interface Config {
  /** Maximum milliseconds to wait for abort-signaled owned work during shutdown. */
  stopTimeoutMs?: number
}

/**
 * Provide the embedded runtime over the composed ApiProxy service.
 * @param ctx - Cordis context carrying ApiProxy and effect ownership.
 * @param config - Optional runtime shutdown settings.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const runtime = new DesktopRuntimeSupervisor({
    createContext: () => createEmbeddedApiProxyAdapter(ctx.apiProxy),
    ...(config.stopTimeoutMs === undefined ? {} : { stopTimeoutMs: config.stopTimeoutMs }),
  })
  ctx.provide('desktopRuntime', runtime)
  ctx.effect(() => () => runtime.stop())
}
