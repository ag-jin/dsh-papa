/**
 * Host-side client bundle catalog. It keeps the browser boot graph separate
 * from the authorized local bundle URL used by packaged desktop transports.
 * @module @deepseek-ai/dsh-client-modules/src/catalog
 */
import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { WebBootEntry, WebBootGraph } from './client/manifest.ts'

/** One active client bundle with its browser graph entry and host path. */
export interface ClientEntry extends WebBootEntry {
  /** Package root that declared the client bundle. */
  packageRoot: string
  /** Absolute path of the built client bundle. */
  clientPath: string
}

/** Host view of the active client bundles. */
export interface ClientBundleCatalog {
  /** Returns the browser-compatible boot graph without host paths. */
  createBootGraph(): WebBootGraph
  /** Resolves an active bundle revision to its local file URL. */
  resolveBundle(id: string, rev: string): URL
  /** Resolves an active bundle's source map after validating its containment. */
  resolveSourceMap(id: string, rev: string): URL
  /** Returns the current content revision after package-root authorization. */
  revisionFor(id: string): string
}

/**
 * Computes the short content revisions used by client bundles and graphs.
 * @param input - bundle bytes or graph serialization to hash.
 * @returns the first twelve hexadecimal SHA-1 characters.
 */
export function shortHash(input: string | Buffer): string {
  return createHash('sha1').update(input).digest('hex').slice(0, 12)
}

function authorizedPath(packageRootPath: string, assetPath: string): string {
  const packageRoot = realpathSync(packageRootPath)
  const resolvedPath = realpathSync(assetPath)
  const fromRoot = relative(packageRoot, resolvedPath)
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error('client bundle escapes its declaring package root')
  }
  return resolvedPath
}

function authorizedClientPath(entry: Pick<ClientEntry, 'packageRoot' | 'clientPath'>): string {
  return authorizedPath(entry.packageRoot, entry.clientPath)
}

function currentRevision(entry: Pick<ClientEntry, 'packageRoot' | 'clientPath'>): string {
  return shortHash(readFileSync(authorizedClientPath(entry)))
}

/**
 * Returns the current bundle revision after validating its declaring package root.
 * @param packageRoot - package root that declared the bundle.
 * @param clientPath - declared built client bundle path.
 * @returns the current short content revision.
 */
export function clientBundleRevision(packageRoot: string, clientPath: string): string {
  return currentRevision({ packageRoot, clientPath })
}

function resolveAuthorizedBundle(entry: ClientEntry, rev: string): URL {
  if (entry.rev !== rev || currentRevision(entry) !== rev) {
    throw new Error('desktop bundle revision mismatch')
  }
  return pathToFileURL(authorizedClientPath(entry))
}

function resolveAuthorizedSourceMap(entry: ClientEntry, rev: string): URL {
  const clientPath = authorizedClientPath(entry)
  resolveAuthorizedBundle(entry, rev)
  return pathToFileURL(authorizedPath(entry.packageRoot, `${clientPath}.map`))
}

function toBootEntry(entry: ClientEntry): WebBootEntry {
  return {
    id: entry.id,
    url: entry.url,
    rev: entry.rev,
    ...(entry.inject === undefined ? {} : { inject: entry.inject }),
    ...(entry.immediately === true ? { immediately: true } : {}),
    ...(entry.external === undefined ? {} : { external: entry.external }),
  }
}

/**
 * Creates a catalog from client bundle entries declared by ClientModuleRegistry.
 * @param entries - active package bundle rows with their declaring roots.
 * @returns the browser graph and host bundle authorization operations.
 */
export function createClientBundleCatalog(entries: readonly ClientEntry[]): ClientBundleCatalog {
  const byId = new Map(entries.map(entry => [entry.id, entry]))
  const bootEntries = entries.map(toBootEntry)
  const graph: WebBootGraph = { rev: shortHash(JSON.stringify(bootEntries)), entries: bootEntries }
  return {
    createBootGraph: () => graph,
    resolveBundle(id, rev) {
      const entry = byId.get(id)
      if (entry === undefined) throw new Error('desktop bundle is not in the active client graph')
      return resolveAuthorizedBundle(entry, rev)
    },
    resolveSourceMap(id, rev) {
      const entry = byId.get(id)
      if (entry === undefined) throw new Error('desktop bundle is not in the active client graph')
      return resolveAuthorizedSourceMap(entry, rev)
    },
    revisionFor(id) {
      const entry = byId.get(id)
      if (entry === undefined) throw new Error('desktop bundle is not in the active client graph')
      return currentRevision(entry)
    },
  }
}
