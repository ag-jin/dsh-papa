/** Packaged desktop locations and shared app-boot integration. */

import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { boot, loadOverlayPatches, resolveBundleDir } from '@deepseek-ai/dsh-app-boot'
import type { ClientBundleCatalog } from '@deepseek-ai/dsh-client-modules'
import type { DesktopRuntimeSupervisor } from '@deepseek-ai/dsh-desktop-runtime'
import { bootDesktopRuntime, type BootedDesktopRuntime, type DesktopBootOptions } from './desktop-boot.ts'

/** Resolved local and packaged resource paths the Electron main process owns. */
export interface PackagedDesktopLocations {
  /** DSH boot paths, with package resolution rooted at unpacked resources when packaged. */
  boot: DesktopBootOptions
  /** Absolute renderer root containing the Vite build. */
  rendererRoot: string
  /** Absolute compiled preload entry path. */
  preloadPath: string
}

/** Inputs that distinguish source execution from a packaged Electron app. */
export interface PackagedDesktopLocationOptions {
  /** Whether Electron is executing a packaged application. */
  isPackaged: boolean
  /** Electron's application resource directory. */
  resourcesPath: string
}

function sourcePackageRoot(): string {
  return fileURLToPath(new URL('../', import.meta.url))
}

/**
 * Resolves desktop resources without importing Electron, so source and packaged paths stay testable.
 * @param options - Electron packaging state and resource directory.
 * @returns Paths for the embedded DSH runtime, renderer, and preload entry.
 */
export function createPackagedDesktopLocations(options: PackagedDesktopLocationOptions): PackagedDesktopLocations {
  const sourceRoot = sourcePackageRoot()
  const packageRoot = options.isPackaged
    ? join(options.resourcesPath, 'app.asar.unpacked')
    : sourceRoot
  return {
    boot: {
      configPath: options.isPackaged
        ? join(options.resourcesPath, 'config', 'cordis.yml')
        : join(sourceRoot, 'config', 'cordis.yml'),
      packageAnchor: join(packageRoot, 'package.json'),
      packageRoot,
      packageRootUrl: pathToFileURL(packageRoot + '/').href,
      presetRoot: options.isPackaged
        ? join(options.resourcesPath, 'config', 'agent-presets')
        : join(sourceRoot, 'config', 'agent-presets'),
    },
    rendererRoot: options.isPackaged
      ? join(options.resourcesPath, 'renderer')
      : fileURLToPath(new URL('../../web/dist/', import.meta.url)),
    preloadPath: fileURLToPath(new URL('./preload-electron.cjs', import.meta.url)),
  }
}

/**
 * Boots the packaged base and desktop patch layers without a browser listener surface.
 * @param locations - Resolved package paths used for the embedded runtime.
 * @returns Settled desktop runtime, active client catalog, and root disposal operation.
 */
export function bootPackagedDesktopRuntime(
  locations: DesktopBootOptions,
): Promise<BootedDesktopRuntime<DesktopRuntimeSupervisor, ClientBundleCatalog>> {
  return bootDesktopRuntime<DesktopRuntimeSupervisor, ClientBundleCatalog>(locations, {
    boot,
    resolveBundleDir,
    loadOverlayPatches,
    resolveModule: (packageAnchor, specifier) => createRequire(packageAnchor).resolve(specifier),
  })
}
