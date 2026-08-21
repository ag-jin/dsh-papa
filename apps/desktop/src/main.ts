/** Security configuration owned by the Electron desktop main process. */

/** BrowserWindow configuration consumed by the Electron launcher. */
export interface DesktopWindowOptions {
  /** Keep the window hidden until the packaged renderer reports readiness. */
  show: false
  /** Initial content width in CSS pixels. */
  width: number
  /** Initial content height in CSS pixels. */
  height: number
  /** Electron renderer hardening options. */
  webPreferences: {
    /** Absolute compiled preload entry path. */
    preload: string
    /** Isolate the renderer world from Electron and Node globals. */
    contextIsolation: true
    /** Never expose Node APIs in renderer JavaScript. */
    nodeIntegration: false
    /** Apply Chromium renderer process sandboxing. */
    sandbox: true
    /** Keep Chromium same-origin enforcement enabled. */
    webSecurity: true
  }
}

/**
 * Returns the restrictive CSP used by the packaged desktop renderer.
 * @returns Policy that permits packaged bootstrap code and catalog-authorized client bundles without network access.
 */
export function createDesktopContentSecurityPolicy(): string {
  return "default-src 'self'; connect-src 'none'; img-src 'self' data:; script-src 'self' dsh-client: 'unsafe-inline' 'unsafe-eval'; style-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
}

/**
 * Creates the hardened BrowserWindow options used for every DSH desktop window.
 * @param preloadPath - Absolute path of the compiled preload entry.
 * @returns Isolated, sandboxed Electron renderer configuration.
 */
export function createDesktopWindowOptions(preloadPath: string): DesktopWindowOptions {
  return {
    show: false,
    width: 1200,
    height: 800,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  }
}
