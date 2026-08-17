/**
 * Real load-path guard for the host-client catalog module. The catalog is
 * imported by the Electron protocol handler in a later task and must remain a
 * plain Node module outside the browser-safe client half, so this guards the
 * package import path used by host code.
 */
import { describe, expect, it } from 'vitest'
import * as catalog from '@deepseek-ai/dsh-client-modules/src/catalog.ts'

describe('dsh-client-modules catalog real-load-path guard', () => {
  it('loads the catalog module from the host package path', () => {
    expect(catalog.createClientBundleCatalog).toBeTypeOf('function')
  })
})
