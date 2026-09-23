/**
 * The remote-host controller reports domain failures as RemoteError codes,
 * serves and stores host records through the opened domain, and never exposes
 * a password; the connection owner keeps one tunnel per host and removes its
 * scratch directories.
 */
import { readdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import type { TunnelChild, TunnelRunner } from '@deepseek-ai/dsh-ssh-tunnel'
import { describe, expect, it, vi } from 'vitest'
import { RemoteHostConnections } from '../src/connections.ts'
import type { ConnectedHost } from '../src/connections.ts'
import { RemoteHostController } from '../src/index.ts'
import { RemoteHostRegistry } from '../src/registry.ts'
import type { RemoteHostId, RemoteHostRecord } from '../src/spec.ts'

const boxRow = { id: 'box', label: 'Box', host: 'box.example', port: 22, user: 'jin', remotePort: 3080, localPort: 51080 }
const boxRecord: RemoteHostRecord = { ...boxRow, id: 'box' as RemoteHostId }
const addInput = { ...boxRecord, password: 'hunter2' }

/** One stored password `grant` record as the credential provider returns it. */
const grantRecord = (password: string) => ({ kind: 'grant' as const, payload: { version: 1, password } })

/**
 * A credential provider double. The SSH password record and the remote Web
 * token live under separate scopes, so the double keys its answer by the
 * requested key rather than returning one record for every scope.
 */
function credentialsDouble(options: { record?: unknown; webToken?: string } = {}) {
  const password = 'record' in options ? options.record : grantRecord('hunter2')
  const token = 'webToken' in options && options.webToken !== undefined
    ? { kind: 'grant' as const, payload: { version: 1, token: options.webToken } }
    : undefined
  return {
    readRecord: vi.fn(async (key: string) => (key.includes('remote-host-web') ? token : password)),
    deleteRecord: vi.fn(async () => undefined),
    modifyRecord: vi.fn(async (_key: unknown, mutate: (current: unknown) => Promise<unknown>) => await mutate(undefined)),
  }
}
type CredentialsDouble = ReturnType<typeof credentialsDouble>

/** A registry over fixed storage, loaded so `list()` serves the given records. */
async function registrySeeded(records: readonly RemoteHostRecord[], credentials: CredentialsDouble = credentialsDouble()):
Promise<RemoteHostRegistry> {
  const registry = new RemoteHostRegistry(credentials as unknown as CredentialProvider, {
    read: async () => [...records],
    write: async () => undefined,
  })
  await registry.load()
  return registry
}

/** A tunnel-owner double that tracks opens and retires entries on close. */
function connectionsDouble(options: {
  live?: readonly ConnectedHost[]
  open?: (record: RemoteHostRecord) => Promise<ConnectedHost>
} = {}) {
  const entries = [...(options.live ?? [])]
  const opened: RemoteHostRecord[] = []
  const closed: RemoteHostId[] = []
  const open = options.open ?? (async (record: RemoteHostRecord) => {
    opened.push(record)
    const connected: ConnectedHost = { id: record.id, localPort: record.localPort }
    if (!entries.some(entry => entry.id === record.id)) entries.push(connected)
    return connected
  })
  const connections = {
    list: () => [...entries],
    open,
    close: async (id: RemoteHostId) => {
      closed.push(id)
      const at = entries.findIndex(entry => entry.id === id)
      if (at >= 0) entries.splice(at, 1)
    },
    closeAll: async () => { entries.splice(0) },
  } as unknown as RemoteHostConnections
  return { connections, opened, closed }
}

/** A controller over real registry code, with its collaborators replaced. */
async function controllerWith(overrides: {
  registry?: RemoteHostRegistry
  connections?: RemoteHostConnections
} = {}): Promise<RemoteHostController> {
  return RemoteHostController.over(new Context(), {
    registry: overrides.registry ?? await registrySeeded([boxRecord]),
    connections: overrides.connections ?? connectionsDouble().connections,
  })
}

/** The KvTable face exercised by the service's storage adapter, over a real map. */
class MemoryTable {
  private readonly records = new Map<string, RemoteHostRecord>()

  get size(): number { return this.records.size }

  get(key: string): RemoteHostRecord | undefined { return this.records.get(key) }

  entries(): IterableIterator<[string, RemoteHostRecord]> { return this.records.entries() }

  keys(): IterableIterator<string> { return this.records.keys() }

  async put(key: string, value: RemoteHostRecord): Promise<void> { this.records.set(key, value) }

  async delete(key: string): Promise<boolean> { return this.records.delete(key) }
}

/** An opened-domain double whose `hosts` table is the given map. */
function storageDomainDouble(table: MemoryTable) {
  const domain = {
    name: 'remote_hosts',
    close: vi.fn(async () => undefined),
    table: (name: string) => {
      if (name !== 'hosts') throw new Error(`domain 'remote_hosts' declares no table '${name}'`)
      return table as unknown as KvTable<RemoteHostId, RemoteHostRecord>
    },
  }
  return { domain, facility: { open: async () => domain } }
}

/** A controller started as a real plugin over the doubles, so `[Service.init]` ran. */
async function startedController(table: MemoryTable, credentials: CredentialsDouble = credentialsDouble()) {
  const { domain, facility } = storageDomainDouble(table)
  const ctx = new Context()
  ctx.provide('credentials', credentials as never)
  ctx.provide('storageDomain', facility as never)
  const fiber = ctx.plugin(RemoteHostController)
  await fiber
  return { controller: ctx.get('remoteHosts') as RemoteHostController, fiber, domain, credentials }
}

describe('RemoteHostController', () => {
  it('reports an unknown host as a domain code rather than a generic failure', async () => {
    const controller = await controllerWith({ registry: await registrySeeded([]) })
    const failure = await controller.remoteExportConnect('missing').catch((error: unknown) => error)

    expect(remoteErrorOf(failure)).toMatchObject({
      code: 'remote-host/unknown',
      details: { id: 'missing' },
    })
  })

  it('reports an unreachable SSH endpoint as its own code', async () => {
    const { connections } = connectionsDouble({
      open: async () => { throw new Error('Connection refused') },
    })
    const controller = await controllerWith({ connections })
    const failure = await controller.remoteExportConnect('box').catch((error: unknown) => error)

    expect(remoteErrorOf(failure)).toMatchObject({
      code: 'remote-host/unreachable',
      details: { id: 'box', host: 'box.example', port: 22 },
    })
  })

  it('reports a bound local port as its own code', async () => {
    const { connections } = connectionsDouble({
      open: async () => { throw new Error('listen EADDRINUSE: address already in use 127.0.0.1:51080') },
    })
    const controller = await controllerWith({ connections })
    const failure = await controller.remoteExportConnect('box').catch((error: unknown) => error)

    expect(remoteErrorOf(failure)).toMatchObject({
      code: 'remote-host/port-taken',
      details: { id: 'box', localPort: 51080 },
    })
  })

  it('reports a host without a stored password as its own code', async () => {
    const registry = await registrySeeded([boxRecord], credentialsDouble({ record: undefined }))
    const controller = await controllerWith({ registry })
    const failure = await controller.remoteExportConnect('box').catch((error: unknown) => error)

    expect(remoteErrorOf(failure)).toMatchObject({
      code: 'remote-host/no-password',
      details: { id: 'box' },
    })
  })

  it('lists configured hosts with their connection state and without any password', async () => {
    const controller = await controllerWith()

    const rows = await controller.remoteExportList()

    expect(rows).toEqual([{ ...boxRow, connected: false }])
    expect(JSON.stringify(rows)).not.toContain('hunter2')
  })

  it('connects by opening the host tunnel and returns the loopback origin', async () => {
    const { connections, opened } = connectionsDouble()
    const controller = await controllerWith({ connections })

    const connection = await controller.remoteExportConnect('box')

    // No Web token is stored, so the frame URL is the bare origin.
    expect(connection).toEqual({
      id: 'box', localPort: 51080, origin: 'http://127.0.0.1:51080', frameUrl: 'http://127.0.0.1:51080/',
    })
    expect(opened).toEqual([boxRecord])
  })

  it('frames the host with its stored remote Web token in the URL', async () => {
    const credentials = credentialsDouble({ webToken: 'remote-token' })
    const controller = await controllerWith({ registry: await registrySeeded([boxRecord], credentials) })

    const connection = await controller.remoteExportConnect('box')

    // The token rides the frame URL so the exchange mints the cookie on the
    // tunnel authority; the origin stays clean for API-facing callers.
    expect(connection.origin).toBe('http://127.0.0.1:51080')
    expect(connection.frameUrl).toBe('http://127.0.0.1:51080/?token=remote-token')
  })

  it('stores a supplied remote Web token and leaves the frame bare without one', async () => {
    const withToken = credentialsDouble()
    const first = await controllerWith({ registry: await registrySeeded([], withToken) })
    await first.remoteExportAdd({ ...addInput, webToken: 'remote-token' })
    expect(withToken.modifyRecord.mock.calls.some(call => call[0] === 'remote-host-web/box')).toBe(true)

    // A blank token is not stored, so the frame loads the bare origin and the
    // remote answers with its own refusal instead of a wrong cookie.
    const blank = credentialsDouble()
    const second = await controllerWith({ registry: await registrySeeded([], blank) })
    await second.remoteExportAdd({ ...addInput, webToken: '' })
    expect(blank.modifyRecord.mock.calls.some(call => call[0] === 'remote-host-web/box')).toBe(false)
  })

  it('adds a host and stores its password without exposing it', async () => {
    const credentials = credentialsDouble()
    const controller = await controllerWith({ registry: await registrySeeded([], credentials) })

    const row = await controller.remoteExportAdd(addInput)

    expect(row).toEqual({ ...boxRow, connected: false })
    expect(JSON.stringify(row)).not.toContain('hunter2')
    expect(credentials.modifyRecord).toHaveBeenCalledOnce()
  })

  it('removes a host together with its tunnel and password record', async () => {
    const credentials = credentialsDouble()
    const { connections, closed } = connectionsDouble()
    const controller = await controllerWith({
      registry: await registrySeeded([boxRecord], credentials),
      connections,
    })

    await controller.remoteExportRemove('box')

    expect(closed).toEqual([boxRecord.id])
    // Both secret scopes go with the host: its SSH password and its Web token.
    expect(credentials.deleteRecord).toHaveBeenCalledTimes(2)
    expect(await controller.remoteExportList()).toEqual([])
  })

  it('disconnects a live tunnel without forgetting the host', async () => {
    const { connections, closed } = connectionsDouble({ live: [{ id: boxRecord.id, localPort: 51080 }] })
    const controller = await controllerWith({ connections })
    expect((await controller.remoteExportList())[0]!.connected).toBe(true)

    await controller.remoteExportDisconnect('box')

    expect(closed).toEqual([boxRecord.id])
    expect((await controller.remoteExportList())[0]!.connected).toBe(false)
  })

  it('fails loud when host storage is used before the domain opens', async () => {
    const ctx = new Context()
    ctx.provide('credentials', credentialsDouble() as never)
    // No override: the constructor wires the real registry over the lazy domain
    // handle, which is what has not opened yet.
    const controller = new RemoteHostController(ctx)

    await expect(controller.remoteExportAdd(addInput)).rejects.toThrow(/domain is not open/)
  })

  it('serves the stored host list from the opened domain and closes everything on dispose', async () => {
    const table = new MemoryTable()
    await table.put('box', { ...boxRecord })
    const closeAll = vi.spyOn(RemoteHostConnections.prototype, 'closeAll').mockResolvedValue()
    const { controller, fiber, domain } = await startedController(table)

    expect(await controller.remoteExportList()).toMatchObject([{ id: 'box', label: 'Box', connected: false }])

    await fiber.dispose()
    expect(domain.close).toHaveBeenCalledOnce()
    expect(closeAll).toHaveBeenCalledOnce()
    closeAll.mockRestore()
  })

  it('writes an added host into the domain table and its password into credentials', async () => {
    const table = new MemoryTable()
    const { controller, fiber, credentials } = await startedController(table)

    const row = await controller.remoteExportAdd(addInput)

    expect(row).toEqual({ ...boxRow, connected: false })
    expect(table.size).toBe(1)
    expect(table.get('box')).toMatchObject({ label: 'Box', localPort: 51080 })
    expect(credentials.modifyRecord).toHaveBeenCalledOnce()
    await fiber.dispose()
  })

  it('deletes a removed host from the table and forgets its password record', async () => {
    const table = new MemoryTable()
    await table.put('box', { ...boxRecord })
    const { controller, fiber, credentials } = await startedController(table)

    await controller.remoteExportRemove('box')

    expect(table.size).toBe(0)
    // Both secret scopes go with the host: its SSH password and its Web token.
    expect(credentials.deleteRecord).toHaveBeenCalledTimes(2)
    expect(await controller.remoteExportList()).toEqual([])
    await fiber.dispose()
  })

  it('drops a table record that appeared after the load, and keeps the ones it writes', async () => {
    // A record written to the domain by another writer after this service
    // loaded is absent from the registry's list; the write path replaces the
    // stored set, so that key is deleted and the written keys survive.
    const table = new MemoryTable()
    const { controller, fiber } = await startedController(table)
    await table.put('external', { ...boxRecord, id: 'external' as RemoteHostId })

    await controller.remoteExportAdd(addInput)

    expect(table.get('external')).toBeUndefined()
    expect(table.get('box')).toMatchObject({ label: 'Box' })
    await fiber.dispose()
  })

  it('rewrites a host already present in the table instead of deleting it first', async () => {
    // The written set naming a key the table already holds is the keep branch:
    // that key must survive the sweep and be overwritten in place.
    const table = new MemoryTable()
    await table.put('box', { ...boxRecord, label: 'Original' })
    const { controller, fiber } = await startedController(table)

    await controller.remoteExportAdd(addInput)

    expect(table.size).toBe(1)
    expect(table.get('box')).toMatchObject({ label: 'Box' })
    await fiber.dispose()
  })

  it('reports an endpoint that fails with a non-Error value as unreachable', async () => {
    // A thrown string reaches the classifier as a non-Error; it must still
    // produce the unreachable code rather than escaping unclassified.
    const { connections } = connectionsDouble({ open: async () => { throw 'ssh exited 255' } })
    const controller = await controllerWith({ connections })
    const failure = await controller.remoteExportConnect('box').catch((error: unknown) => error)

    expect(remoteErrorOf(failure)).toMatchObject({
      code: 'remote-host/unreachable',
      details: { id: 'box', host: 'box.example', port: 22 },
    })
  })
})

describe('RemoteHostConnections', () => {
  /** A tunnel process seam: records spawns, reports the master as ready or never. */
  function tunnelRunnerDouble(ready: boolean) {
    const spawns: string[][] = []
    const child: TunnelChild = {
      pid: 4242,
      kill: vi.fn(() => true),
      once: vi.fn(() => child),
      on: vi.fn(() => child),
    }
    const runner: TunnelRunner = {
      spawn: (_file: string, args: string[]) => { spawns.push([...args]); return child },
      check: async () => ready,
      terminate: async () => undefined,
      read: async () => undefined,
    }
    return { spawns, runner }
  }

  function connectionsWith(runner: TunnelRunner): RemoteHostConnections {
    return new RemoteHostConnections({ runner, readyTimeoutMs: 100 })
  }

  it('opens one tunnel per host and reuses it for a second open', async () => {
    const { spawns, runner } = tunnelRunnerDouble(true)
    const connections = connectionsWith(runner)

    const first = await connections.open(boxRecord, 'hunter2')
    const second = await connections.open({ ...boxRecord }, 'hunter2')

    expect(first).toEqual({ id: 'box', localPort: 51080 })
    expect(second).toEqual(first)
    expect(spawns).toHaveLength(1)
    const args = spawns[0]!
    expect(args[args.indexOf('-L') + 1]).toBe('127.0.0.1:51080:127.0.0.1:3080')
    expect(connections.list()).toEqual([{ id: 'box', localPort: 51080 }])
    await connections.closeAll()
    expect(connections.list()).toEqual([])
  })

  it('removes the tunnel and its scratch directory on close', async () => {
    const { runner } = tunnelRunnerDouble(true)
    const connections = connectionsWith(runner)
    const known = new Set(await readdir(tmpdir()))

    await connections.open(boxRecord, 'hunter2')
    const [directory] = (await readdir(tmpdir())).filter(name => name.startsWith('dsh-remote-host-') && !known.has(name))
    expect(directory).toBeTypeOf('string')

    await connections.close(boxRecord.id)

    await expect(stat(join(tmpdir(), directory!))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('removes the scratch directory when the endpoint never becomes ready', async () => {
    const { runner } = tunnelRunnerDouble(false)
    const connections = connectionsWith(runner)
    const known = new Set(await readdir(tmpdir()))

    await expect(connections.open(boxRecord, 'hunter2')).rejects.toThrow(/did not become ready/)

    const leaked = (await readdir(tmpdir())).filter(name => name.startsWith('dsh-remote-host-') && !known.has(name))
    expect(leaked).toEqual([])
    await expect(connections.close(boxRecord.id)).resolves.toBeUndefined()
  })
})
