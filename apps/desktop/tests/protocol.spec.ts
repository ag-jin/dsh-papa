import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createDesktopProtocolHandler } from '../src/protocol.ts'

describe('desktop resource protocol', () => {
  it('serves only packaged renderer files and catalog-authorized client bundles', async () => {
    const rendererRoot = mkdtempSync(join(tmpdir(), 'dsh-desktop-renderer-'))
    writeFileSync(join(rendererRoot, 'index.html'), '<main>desktop</main>')
    const bundle = join(rendererRoot, 'plugin.js')
    writeFileSync(bundle, 'export {}')
    const handler = createDesktopProtocolHandler({
      rendererRoot,
      catalog: {
        createBootGraph: () => ({ rev: 'graph', entries: [{ id: 'plugin', url: '/plugins/plugin/client.js?rev=rev', rev: 'rev' }] }),
        resolveBundle: (id, rev) => {
          if (id !== 'plugin' || rev !== 'rev') throw new Error('desktop bundle is not in the active client graph')
          return new URL('file://' + bundle)
        },
      },
    })

    const index = await handler.fetch(new URL('dsh-app://renderer/index.html'))
    expect(index.status).toBe(200)
    await expect(index.text()).resolves.toContain('window.__DSH_BOOT__ = {"rev":"graph","entries":[{"id":"plugin","url":"dsh-client://bundle/plugin?rev=rev","rev":"rev"}]}')
    await expect(handler.fetch(new URL('dsh-client://bundle/plugin?rev=rev'))).resolves.toMatchObject({ status: 200 })
    await expect(handler.fetch(new URL('dsh-client://bundle/etc/passwd?rev=rev'))).rejects.toThrow('desktop bundle is not in the active client graph')
    await expect(handler.fetch(new URL('dsh-app://renderer/..%2F..%2Fpackage.json'))).rejects.toThrow('desktop renderer path escapes packaged root')
  })
})
