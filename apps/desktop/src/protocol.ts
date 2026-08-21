/** Packaged renderer and client-bundle protocol handler for Electron main. */

import { readFile, realpath } from 'node:fs/promises'
import { extname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { injectBootManifest } from '@deepseek-ai/dsh-client-modules'

/** One renderer entry in the desktop boot graph. */
export interface DesktopBootEntry {
  /** Active package identifier. */
  id: string
  /** Browser or desktop transport URL for the entry. */
  url: string
  /** Active bundle revision. */
  rev: string
  /** Optional package dependency edges. */
  inject?: string[]
  /** Whether module loading prefetches this entry. */
  immediately?: boolean
}

/** Active client graph read by the packaged renderer before its shell executes. */
export interface DesktopBootGraph {
  /** Revision for the complete client entry graph. */
  rev: string
  /** Active client entries. */
  entries: DesktopBootEntry[]
}

/** Host-side capability required to authorize one packaged client bundle. */
export interface DesktopBundleCatalog {
  /** Returns the active client graph before desktop protocol URL rewriting. */
  createBootGraph(): DesktopBootGraph
  /** Resolves an active client-bundle revision after catalog authorization. */
  resolveBundle(id: string, rev: string): URL
}

/** Dependencies owned by the packaged desktop resource protocol. */
export interface DesktopProtocolOptions {
  /** Absolute root directory containing the Vite-built renderer. */
  rendererRoot: string
  /** Active client-bundle catalog from the composed DSH runtime. */
  catalog: DesktopBundleCatalog
}

/** Electron protocol adapter containing only a fetch-compatible handler. */
export interface DesktopProtocolHandler {
  /** Resolves one approved desktop resource URL. */
  fetch(resource: URL): Promise<Response>
}

function escapesRoot(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate)
  return fromRoot === '..' || fromRoot.startsWith('../') || fromRoot.startsWith('..\\')
}

function contentType(path: string): string {
  switch (extname(path)) {
    case '.css': return 'text/css; charset=utf-8'
    case '.html': return 'text/html; charset=utf-8'
    case '.js': return 'text/javascript; charset=utf-8'
    case '.json': return 'application/json; charset=utf-8'
    case '.svg': return 'image/svg+xml'
    case '.woff2': return 'font/woff2'
    default: return 'application/octet-stream'
  }
}

function decodedPathname(resource: URL): string {
  try {
    return decodeURIComponent(resource.pathname)
  } catch {
    throw new Error('desktop resource path is malformed')
  }
}

async function responseForFile(path: string): Promise<Response> {
  return new Response(await readFile(path), { headers: { 'content-type': contentType(path) } })
}

function desktopBootGraph(graph: DesktopBootGraph): DesktopBootGraph {
  return {
    rev: graph.rev,
    entries: graph.entries.map(entry => ({
      id: entry.id,
      url: `dsh-client://bundle/${encodeURIComponent(entry.id)}?rev=${encodeURIComponent(entry.rev)}`,
      rev: entry.rev,
      ...(entry.inject === undefined ? {} : { inject: entry.inject }),
      ...(entry.immediately === true ? { immediately: true } : {}),
    })),
  }
}

/**
 * Creates an Electron fetch handler for packaged renderer assets and authorized client bundles.
 * @param options - Packaged renderer root and active DSH client-bundle catalog.
 * @returns Fixed protocol fetch handler with no filesystem operation chosen by the renderer.
 */
export function createDesktopProtocolHandler(options: DesktopProtocolOptions): DesktopProtocolHandler {
  const rootPromise = realpath(options.rendererRoot)
  return {
    async fetch(resource) {
      if (resource.protocol === 'dsh-app:' && resource.hostname === 'renderer') {
        const root = await rootPromise
        const decoded = decodedPathname(resource)
        const candidate = resolve(root, '.' + decoded)
        if (escapesRoot(root, candidate)) throw new Error('desktop renderer path escapes packaged root')
        const asset = await realpath(candidate)
        if (escapesRoot(root, asset)) throw new Error('desktop renderer path escapes packaged root')
        if (extname(asset) === '.html') {
          const html = await readFile(asset, 'utf8')
          return new Response(injectBootManifest(html, desktopBootGraph(options.catalog.createBootGraph())), {
            headers: { 'content-type': contentType(asset) },
          })
        }
        return responseForFile(asset)
      }
      if (resource.protocol === 'dsh-client:' && resource.hostname === 'bundle') {
        const id = decodedPathname(resource).replace(/^\//, '')
        const rev = resource.searchParams.get('rev')
        if (id.length === 0 || rev === null || rev.length === 0) throw new Error('desktop client bundle URL is incomplete')
        const bundle = options.catalog.resolveBundle(id, rev)
        if (bundle.protocol !== 'file:') throw new Error('desktop client bundle must resolve to a local file')
        return responseForFile(fileURLToPath(bundle))
      }
      throw new Error('desktop protocol resource is not authorized')
    },
  }
}
