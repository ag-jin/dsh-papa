/** Listener-free DSH desktop composition boot. */

import { isAbsolute, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'

/** One shared Include patch passed to the DSH Loader boot helper. */
export type DesktopBootPatch = PatchOptions

/** Resolved desktop application locations required before Cordis starts. */
export interface DesktopBootOptions {
  /** Absolute empty root config path owned by the desktop package. */
  configPath: string
  /** Absolute desktop package manifest used as the installed-package resolution anchor. */
  packageAnchor: string
  /** Absolute desktop package directory used as the secondary bundle resolver anchor. */
  packageRoot: string
  /** File URL for resolving bare desktop bundle packages in the packaged app. */
  packageRootUrl: string
  /** Read-only shipped agent-preset root owned by the desktop package. */
  presetRoot: string
}

/** Settled root context fields required by the desktop main process. */
export interface DesktopBootContext {
  /** Root Cordis lifetime controller. */
  fiber: { dispose(): Promise<void> }
  /** Returns one settled service by its registered name. */
  get(name: string): unknown
}

/** App-boot operations used to compose the listener-free desktop tree. */
export interface DesktopBootDependencies {
  /** Starts the Loader tree over an absolute root config and ordered overlay patches. */
  boot(
    name: string,
    configPath: string,
    patches: DesktopBootPatch[],
    prepare: (ctx: Context) => Promise<void> | void,
    bareModuleBaseUrl: string,
  ): Promise<DesktopBootContext>
  /** Resolves one installed bundle package directory. */
  resolveBundleDir(name: string, packageName: string, packageAnchor: string, profileDirectory: string): string
  /** Parses one required bundle overlay patch file. */
  loadOverlayPatches(name: string, path: string): DesktopBootPatch[]
  /** Resolves a bare package entry from the desktop application manifest. */
  resolveModule(packageAnchor: string, specifier: string): string
}

/** Settled desktop services and their shared root lifetime. */
export interface BootedDesktopRuntime<Runtime = unknown, Catalog = unknown> {
  /** Embedded no-listener runtime supervisor. */
  runtime: Runtime
  /** Active client-bundle catalog used by the packaged protocol. */
  catalog: Catalog
  /** Disposes the root context and every owned desktop runtime effect. */
  dispose(): Promise<void>
}

function resolveEntryName(name: string, packageAnchor: string, resolveModule: DesktopBootDependencies['resolveModule']): string {
  if (name.startsWith('.') || name.startsWith('cordis:') || name.startsWith('node:') || isAbsolute(name)) return name
  return resolveModule(packageAnchor, name)
}

/** Resolves only PatchOptions module fields; plugin configuration remains opaque. */
function resolvePatchModules(patches: DesktopBootPatch[], packageAnchor: string, resolveModule: DesktopBootDependencies['resolveModule']): DesktopBootPatch[] {
  return patches.map(patch => ({
    ...patch,
    ...(patch.name === undefined ? {} : {
      name: resolveEntryName(patch.name, packageAnchor, resolveModule),
    }),
    ...(patch.insert === undefined ? {} : {
      insert: patch.insert.map(entry => ({
        ...entry,
        name: resolveEntryName(entry.name, packageAnchor, resolveModule),
      })),
    }),
  }))
}

/**
 * Boots base plus desktop overlays and adds only the desktop package's system preset root.
 * @param options - Resolved desktop package locations.
 * @param dependencies - Shared app-boot functions, injected for deterministic tests.
 * @returns Settled embedded runtime and active client-bundle catalog.
 * @throws When either required desktop service is absent after Loader settlement.
 */
export async function bootDesktopRuntime<Runtime = unknown, Catalog = unknown>(
  options: DesktopBootOptions,
  dependencies: DesktopBootDependencies,
): Promise<BootedDesktopRuntime<Runtime, Catalog>> {
  const baseDirectory = dependencies.resolveBundleDir('dsh-desktop', '@deepseek-ai/dsh-base', options.packageAnchor, options.packageRoot)
  const desktopDirectory = dependencies.resolveBundleDir('dsh-desktop', '@deepseek-ai/dsh-desktop-app', options.packageAnchor, options.packageRoot)
  const patches = resolvePatchModules([
    ...dependencies.loadOverlayPatches('dsh-desktop', join(baseDirectory, 'cordis.patch.yml')),
    ...dependencies.loadOverlayPatches('dsh-desktop', join(desktopDirectory, 'cordis.patch.yml')),
    { id: 'agent-presets', config: { default: 'standard', roots: [{ path: options.presetRoot, trust: 'system' }] } },
  ], options.packageAnchor, dependencies.resolveModule)
  const context = await dependencies.boot('dsh-desktop', options.configPath, patches, async (ctx) => {
    await ctx.plugin(InvariantRegistry)
  }, options.packageRootUrl)
  const runtime = context.get('desktopRuntime')
  const clientModules = context.get('clientModules') as { catalog?: () => Catalog } | undefined
  if (runtime === undefined || clientModules?.catalog === undefined) {
    await context.fiber.dispose()
    throw new Error('dsh-desktop: required listener-free desktop services did not activate')
  }
  return {
    runtime: runtime as Runtime,
    catalog: clientModules.catalog(),
    dispose: () => context.fiber.dispose(),
  }
}
