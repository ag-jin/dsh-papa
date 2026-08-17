import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createClientBundleCatalog,
  type ClientEntry,
} from '@deepseek-ai/dsh-client-modules'

const BUNDLE_V1_REV = 'e21669a54929'
const BUNDLE_V2_REV = '1cc256eabe6a'
let root: string | undefined

afterEach(() => {
  if (root !== undefined) rmSync(root, { recursive: true, force: true })
  root = undefined
})

function writeClientEntry(content = 'bundle-v1\n'): ClientEntry {
  root ??= mkdtempSync(join(tmpdir(), 'dsh-client-catalog-'))
  const packageRoot = join(root, 'package')
  const clientPath = join(packageRoot, 'lib', 'client.js')
  mkdirSync(dirname(clientPath), { recursive: true })
  writeFileSync(clientPath, content)
  return {
    id: '@deepseek-ai/dsh-client-runtime',
    url: 'dsh-client://bundle/runtime.js',
    rev: content === 'bundle-v1\n' ? BUNDLE_V1_REV : BUNDLE_V2_REV,
    clientPath,
    packageRoot,
  }
}

describe('createClientBundleCatalog', () => {
  it('creates a content-addressed boot graph from declared package bundle rows', () => {
    const entry = writeClientEntry()
    const catalog = createClientBundleCatalog([entry])

    expect(catalog.createBootGraph().entries).toEqual([
      { id: '@deepseek-ai/dsh-client-runtime', url: 'dsh-client://bundle/runtime.js', rev: BUNDLE_V1_REV },
    ])
    expect(catalog.resolveBundle('@deepseek-ai/dsh-client-runtime', BUNDLE_V1_REV).protocol)
      .toBe('file:')
  })

  it('rejects a client bundle symlink that escapes its declaring package root', () => {
    const entry = writeClientEntry()
    const external = join(root!, 'outside-client.js')
    writeFileSync(external, 'bundle-v1\n')
    rmSync(entry.clientPath)
    symlinkSync(external, entry.clientPath)
    const catalog = createClientBundleCatalog([entry])

    expect(() => catalog.resolveBundle(entry.id, BUNDLE_V1_REV))
      .toThrow('client bundle escapes its declaring package root')
  })

  it('rejects an active bundle whose contents no longer match its revision', () => {
    const entry = writeClientEntry()
    const catalog = createClientBundleCatalog([entry])
    writeFileSync(entry.clientPath, 'bundle-v2\n')

    expect(() => catalog.resolveBundle(entry.id, BUNDLE_V1_REV))
      .toThrow('desktop bundle revision mismatch')
    expect(catalog.revisionFor(entry.id)).toBe(BUNDLE_V2_REV)
  })

  it('rejects an unknown package id or mismatched revision', () => {
    const entry = writeClientEntry()
    const catalog = createClientBundleCatalog([entry])

    expect(() => catalog.resolveBundle('@deepseek-ai/dsh-client-unknown', BUNDLE_V1_REV))
      .toThrow('desktop bundle is not in the active client graph')
    expect(() => catalog.resolveBundle(entry.id, BUNDLE_V2_REV))
      .toThrow('desktop bundle revision mismatch')
  })
})
