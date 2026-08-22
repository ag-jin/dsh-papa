/** Executable ready-state invariant for the no-listener desktop runtime. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type {} from './plugin.ts'
import type { DesktopRuntimeSnapshot } from './runtime.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-desktop-runtime'

/** Cordis companion plugin name. */
export const name = 'desktop-runtime-invariant'

/** Service required before the companion can register. */
export const inject = ['invariants']

/** Input facts checked by the desktop runtime ready-state invariant. */
export interface DesktopRuntimeInvariantInput {
  /** Runtime lifecycle state. */
  state: DesktopRuntimeSnapshot['state']
  /** Whether the embedded ApiProxy is available. */
  apiProxyReady: boolean
  /** Whether a web server has been introduced into desktop runtime. */
  webServerPresent: boolean
}

/**
 * Assert the ownership relation required when desktop runtime is ready.
 * @param snapshot - Runtime state facts observed after startup.
 * @returns Nothing when the ready-state relation holds.
 */
export function assertDesktopRuntimeInvariant(snapshot: DesktopRuntimeInvariantInput): void {
  if (snapshot.state !== 'ready') return
  if (!snapshot.apiProxyReady) throw new Error('ready desktop runtime requires ApiProxy')
  if (snapshot.webServerPresent) throw new Error('desktop runtime must not own a web server')
}

/** Run the package-owned ready-state check against the composed runtime. */
const install: InvariantInstaller = (ctx, fail) => {
  const runtime = ctx.get('desktopRuntime')
  if (runtime === undefined) return
  try {
    assertDesktopRuntimeInvariant({
      ...runtime.snapshot(),
      webServerPresent: ctx.get('webServer') !== undefined,
    })
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error))
  }
}

/**
 * Register the desktop runtime invariant companion.
 * @param ctx - Cordis context carrying the invariant registry.
 * @returns Registered invariant disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
