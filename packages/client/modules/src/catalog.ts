/**
 * Host-side client bundle catalog. It keeps the browser boot graph separate
 * from the authorized local bundle URL used by packaged desktop transports.
 * @module @deepseek-ai/dsh-client-modules/src/catalog
 */
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import type { WebBootEntry, WebBootGraph } from './client/manifest.ts'

/** One active client bundle with its browser graph entry and host path. */
export interface ClientEntry extends WebBootEntry {
  /** Absolute path of the built client bundle. */
  clientPath: string
}

/** Host view of the active client bundles. */
export interface ClientBundleCatalog {
  /** Returns the browser-compatible boot graph without host paths. */
  createBootGraph(): WebBootGraph
  /** Resolves an active bundle revision to its local file URL. */
  resolveBundle(id: string, rev: string): URL
}

/** Computes the short content revisions used by client bundles and graphs. */
export function shortHash(input: string | Buffer): string {
  return createHash('sha1').update(input).digest('hex').slice(0, 12)
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

/** Creates a catalog from entries already authorized by ClientModuleRegistry. */
export function createClientBundleCatalog(entries: readonly ClientEntry[]): ClientBundleCatalog {
  const byId = new Map(entries.map(entry => [entry.id, entry]))
  const bootEntries = entries.map(toBootEntry)
  const graph: WebBootGraph = { rev: shortHash(JSON.stringify(bootEntries)), entries: bootEntries }
  return {
    createBootGraph: () => graph,
    resolveBundle(id, rev) {
      const entry = byId.get(id)
      if (entry === undefined) throw new Error('desktop bundle is not in the active client graph')
      if (entry.rev !== rev) throw new Error('desktop bundle revision mismatch')
      return pathToFileURL(entry.clientPath)
    },
  }
}
