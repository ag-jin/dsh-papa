/** Renderer global contributed only by the Electron preload entry. */

import type { DesktopPreloadBridge } from './preload.ts'

declare global {
  interface Window {
    /** Fixed JSON bridge present only in the packaged desktop renderer. */
    __DSH_DESKTOP__?: DesktopPreloadBridge
  }
}

export {}
