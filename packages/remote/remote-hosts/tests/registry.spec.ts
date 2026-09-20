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

  it('reports a missing password rather than returning an empty one', async () => {
    const { RemoteHostRegistry } = await import('../src/registry.ts')
    const credentials = { readRecord: async () => undefined }
    const storage = { read: async () => [], write: async () => undefined }
    const registry = new RemoteHostRegistry(credentials as never, storage)

    await expect(registry.passwordOf('box' as never)).rejects.toThrow(/no ssh password/)
  })

  it('refuses a stored record of the wrong kind instead of reading it as absent', async () => {
    const { RemoteHostRegistry } = await import('../src/registry.ts')
    const credentials = { readRecord: async () => ({ kind: 'apiKey', payload: { key: 'x' } }) }
    const storage = { read: async () => [], write: async () => undefined }
    const registry = new RemoteHostRegistry(credentials as never, storage)

    await expect(registry.passwordOf('box' as never)).rejects.toThrow(/unsupported format/)
  })

  it('refuses a stored record whose payload this version does not know', async () => {
    const { RemoteHostRegistry } = await import('../src/registry.ts')
    const credentials = {
      readRecord: async () => ({ kind: 'grant', payload: { version: 99, password: 'stale' } }),
    }
    const storage = { read: async () => [], write: async () => undefined }
    const registry = new RemoteHostRegistry(credentials as never, storage)

    await expect(registry.passwordOf('box' as never)).rejects.toThrow(/invalid payload/)
  })
})

describe('RemoteHostRegistry storage', () => {
  function registryWith(overrides: { read?: () => Promise<unknown[]>; write?: (r: unknown) => Promise<void> } = {}) {
    return import('../src/registry.ts').then(({ RemoteHostRegistry }) => {
      const writes: unknown[][] = []
      const storage = {
        read: overrides.read ?? (async () => []),
        write: overrides.write ?? (async (records: unknown) => { writes.push(records as unknown[]) }),
      }
      const credentials = {
        readRecord: async () => undefined,
        deleteRecord: vi.fn(async () => undefined),
        modifyRecord: vi.fn(async (_key: unknown, mutate: (c: unknown) => Promise<unknown>) => await mutate(undefined)),
      }
      return { registry: new RemoteHostRegistry(credentials as never, storage), writes, credentials }
    })
  }

  it('adds a host and replaces an existing record with the same id', async () => {
    const { registry, writes } = await registryWith()
    const record = parseRemoteHostRecord(valid)
    await registry.add(record)
    expect(registry.list()).toHaveLength(1)

    await registry.add(parseRemoteHostRecord({ ...valid, label: 'Renamed' }))
    expect(registry.list()).toHaveLength(1)
    expect(registry.list()[0]!.label).toBe('Renamed')
    expect(writes).toHaveLength(2)
  })

  it('removes a host together with its password record', async () => {
    const { registry, credentials } = await registryWith()
    await registry.add(parseRemoteHostRecord(valid))
    await registry.remove(registry.list()[0]!.id)

    expect(registry.list()).toHaveLength(0)
    // Both secret scopes go with the host: its SSH password and its Web token.
    expect(credentials.deleteRecord).toHaveBeenCalledTimes(2)
  })

  it('stores a replacement password as a versioned grant record', async () => {
    const { registry, credentials } = await registryWith()
    await registry.setPassword('box' as never, 'replacement')

    expect(credentials.modifyRecord).toHaveBeenCalledOnce()
    expect(credentials.modifyRecord.mock.calls[0]![0]).toBe('remote-host-ssh/box')
  })

  it('stores the remote Web token under its own scope', async () => {
    const { registry, credentials } = await registryWith()
    await registry.setWebToken('box' as never, 'remote-token')

    // A token is a second secret beside the password: separate scope, so
    // rotating one never disturbs the other.
    expect(credentials.modifyRecord).toHaveBeenCalledOnce()
    expect(credentials.modifyRecord.mock.calls[0]![0]).toBe('remote-host-web/box')
  })

  it('loads stored hosts in their stored order', async () => {
    const { registry } = await registryWith({
      read: async () => [{ ...valid, id: 'one' }, { ...valid, id: 'two' }],
    })
    const loaded = await registry.load()

    expect(loaded.map(record => record.id)).toEqual(['one', 'two'])
    expect(registry.list()).toHaveLength(2)
  })
})
