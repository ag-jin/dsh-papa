import { describe, expect, it } from 'vitest'
import {
  createClientBundleCatalog,
  type ClientEntry,
} from '@deepseek-ai/dsh-client-modules'

describe('createClientBundleCatalog', () => {
  it('creates a content-addressed boot graph from composed client rows', () => {
    const entries: readonly ClientEntry[] = [
      { id: '@deepseek-ai/dsh-client-runtime', url: 'dsh-client://bundle/runtime.js', rev: 'abc', clientPath: '/tmp/runtime/client.js' },
    ]
    const catalog = createClientBundleCatalog(entries)

    expect(catalog.createBootGraph().entries).toEqual([
      { id: '@deepseek-ai/dsh-client-runtime', url: 'dsh-client://bundle/runtime.js', rev: 'abc' },
    ])
    expect(catalog.resolveBundle('@deepseek-ai/dsh-client-runtime', 'abc').href)
      .toBe('file:///tmp/runtime/client.js')
  })

  it('rejects an unknown package id or mismatched revision', () => {
    const entries: readonly ClientEntry[] = [
      { id: '@deepseek-ai/dsh-client-runtime', url: 'dsh-client://bundle/runtime.js', rev: 'abc', clientPath: '/tmp/runtime/client.js' },
    ]
    const catalog = createClientBundleCatalog(entries)

    expect(() => catalog.resolveBundle('@deepseek-ai/dsh-client-unknown', 'abc'))
      .toThrow('desktop bundle is not in the active client graph')
    expect(() => catalog.resolveBundle('@deepseek-ai/dsh-client-runtime', 'wrong'))
      .toThrow('desktop bundle revision mismatch')
  })
})
