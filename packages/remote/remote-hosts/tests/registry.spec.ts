/** The registry validates a record before it is durable and keeps the password out of the record. */
import { describe, expect, it, vi } from 'vitest'
import { parseRemoteHostRecord } from '../src/spec.ts'

const valid = {
  id: 'box',
  label: 'Build box',
  host: 'box.example',
  port: 30028,
  user: 'jin',
  remotePort: 3080,
  localPort: 51080,
}

describe('parseRemoteHostRecord', () => {
  it('accepts a complete record', () => {
    expect(parseRemoteHostRecord(valid)).toMatchObject({ id: 'box', localPort: 51080 })
  })

  it('refuses an id that is not a credential-key segment', () => {
    expect(() => parseRemoteHostRecord({ ...valid, id: 'box/other' })).toThrow()
  })

  it('refuses a local port outside the TCP range', () => {
    expect(() => parseRemoteHostRecord({ ...valid, localPort: 0 })).toThrow()
  })

  it('refuses a record carrying a password field', () => {
    expect(() => parseRemoteHostRecord({ ...valid, password: 'leak' })).toThrow()
  })
})

describe('RemoteHostRegistry.passwordOf', () => {
  it('reads the password from the credential record rather than the host record', async () => {
    const { RemoteHostRegistry } = await import('../src/registry.ts')
    const readRecord = vi.fn(async () => ({
      kind: 'grant' as const,
      payload: { version: 1, password: 'hunter2' },
    }))
    const credentials = { readRecord }
    const storage = { read: async () => [], write: async () => undefined }
    const registry = new RemoteHostRegistry(credentials as never, storage)

    await expect(registry.passwordOf('box' as never)).resolves.toBe('hunter2')
    expect(readRecord).toHaveBeenCalledOnce()
  })
})
