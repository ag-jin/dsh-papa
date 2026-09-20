/**
 * The remote-host feature's Host half: durable host records, their SSH
 * passwords, the tunnels to them, and the `ctx.remote.remoteHosts` namespace
 * the Web GUI calls. The client-safe payload types are re-exported from
 * `./types.ts` for the generated Remote client.
 * @module @deepseek-ai/dsh-remote-hosts
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { RemoteHostConnections } from './connections.ts'
import { RemoteHostRegistry } from './registry.ts'
import type { RemoteHostStorage } from './registry.ts'
import { parseRemoteHostRecord, remoteHostDomainSpec } from './spec.ts'
import type { RemoteHostId, RemoteHostRecord } from './spec.ts'

export type { RemoteHostId, RemoteHostRecord } from './spec.ts'
export { parseRemoteHostRecord, remoteHostRecordSchema } from './spec.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** No configured host carries that id. */
    'remote-host/unknown': { readonly id: string }
    /** The SSH endpoint refused the connection, the port, or the password. */
    'remote-host/unreachable': { readonly id: string; readonly host: string; readonly port: number }
    /** The host is configured but stores no readable SSH password. */
    'remote-host/no-password': { readonly id: string }
    /** The local tunnel port is already bound by another process. */
    'remote-host/port-taken': { readonly id: string; readonly localPort: number }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Remote-host records, passwords, tunnels, and Remote namespace owner. */
    remoteHosts: RemoteHostController
  }
}

/** What the Client receives for one configured host; never a password. */
export interface RemoteHostRow {
  /** Stable host id. */
  readonly id: string
  /** Operator-facing display name. */
  readonly label: string
  /** SSH host name or address. */
  readonly host: string
  /** SSH port. */
  readonly port: number
  /** Remote login user. */
  readonly user: string
  /** The remote Harness Web port the tunnel forwards to. */
  readonly remotePort: number
  /** The local loopback port the tunnel binds. */
  readonly localPort: number
  /** Whether the host's tunnel is currently live. */
  readonly connected: boolean
}

/** Wire input of `remoteHosts.add`: the host fields plus its password. */
export interface RemoteHostAddInput {
  /** Stable host id; a duplicate id replaces the existing record. */
  readonly id: string
  /** Operator-facing display name. */
  readonly label: string
  /** SSH host name or address. */
  readonly host: string
  /** SSH port. */
  readonly port: number
  /** Remote login user. */
  readonly user: string
  /** The remote Harness Web port the tunnel forwards to. */
  readonly remotePort: number
  /** The local loopback port the tunnel binds. */
  readonly localPort: number
  /** The SSH password stored under the host's credential record. */
  readonly password: string
  /**
   * The remote Harness's Web launch token, when the operator has one. Blank or
   * absent leaves the frame unauthenticated against the remote.
   */
  readonly webToken?: string
}

/** One connection's resolved state, as the frame loader needs it. */
export interface RemoteHostConnection {
  /** The connected host's id. */
  readonly id: string
  /** The local loopback port the tunnel listens on. */
  readonly localPort: number
  /** The tunnel origin the remote's API is reached through. */
  readonly origin: string
  /**
   * The absolute URL the frame loads. The remote's Web server authenticates its
   * root request with its launch token, so a stored token rides this URL and the
   * exchange mints the cookie bound to the tunnel authority. Without a token
   * this is the bare origin and the frame shows the remote's own refusal.
   */
  readonly frameUrl: string
}

/** Host service backing the generated `ctx.remote.remoteHosts` namespace. */
export class RemoteHostController extends TypertRemoteService {
  static inject = ['credentials', 'storageDomain']

  private registry: RemoteHostRegistry
  private connections: RemoteHostConnections
  private storage: RemoteHostStorage | undefined

  /**
   * @param ctx - Host context carrying the credential store and the storage domain.
   */
  constructor(ctx: Context) {
    super(ctx, 'remoteHosts', { namespace: 'remoteHosts' })
    this.connections = new RemoteHostConnections()
    this.registry = new RemoteHostRegistry(ctx.credentials, {
      read: async () => await this.storageHandle().read(),
      write: async (records) => { await this.storageHandle().write(records) },
    })
    ctx.effect(() => () => this.connections.closeAll(), 'remote-hosts:closeTunnels')
  }

  /**
   * A controller over replaced collaborators, for direct unit tests. The Loader
   * constructs through the constructor above, so this stays a test seam rather
   * than a deployment option: a `cordis.yml` cannot name it, and the
   * constructor keeps its second parameter free for a `Config`.
   * @param ctx - Host context, usually a bare `Context`.
   * @param overrides - the tunnel owner and registry to use instead of the real ones.
   * @returns a controller that spawns no `ssh` and reads no durable store.
   */
  static over(ctx: Context, overrides: {
    connections: RemoteHostConnections
    registry: RemoteHostRegistry
  }): RemoteHostController {
    const controller = new RemoteHostController(ctx)
    controller.connections = overrides.connections
    controller.registry = overrides.registry
    return controller
  }

  /** Open the durable domain and load the stored host list; host reads and writes fail until this ran. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(remoteHostDomainSpec)
    this.ctx.effect(() => () => domain.close(), 'remote-hosts:domainClose')
    const table: KvTable<RemoteHostId, RemoteHostRecord> = domain.table('hosts')
    this.storage = {
      read: () => Promise.resolve([...table.entries()].map(([, record]) => record)),
      write: async (records) => {
        const keep = new Set<RemoteHostId>(records.map(record => record.id))
        for (const key of [...table.keys()]) {
          if (!keep.has(key)) await table.delete(key)
        }
        for (const record of records) await table.put(record.id, record)
      },
    }
    await this.registry.load()
  }

  /** The opened domain handle; a read or write before `[Service.init]` is a caller bug. */
  private storageHandle(): RemoteHostStorage {
    if (this.storage === undefined) throw new Error('remote-hosts: the host domain is not open')
    return this.storage
  }

  /** Ids of the hosts whose tunnel is currently live. */
  private connectedIds(): ReadonlySet<string> {
    return new Set(this.connections.list().map(entry => entry.id))
  }

  /** Project one record to its Client row against a set of connected ids. */
  private rowOf(record: RemoteHostRecord, connected: ReadonlySet<string>): RemoteHostRow {
    return {
      id: record.id,
      label: record.label,
      host: record.host,
      port: record.port,
      user: record.user,
      remotePort: record.remotePort,
      localPort: record.localPort,
      connected: connected.has(record.id),
    }
  }

  /**
   * Every configured host and whether its tunnel is live.
   * @returns the rows the host switcher renders.
   */
  @Remote('list')
  remoteExportList(): Promise<RemoteHostRow[]> {
    const connected = this.connectedIds()
    return Promise.resolve(this.registry.list().map(record => this.rowOf(record, connected)))
  }

  /**
   * Add or replace one host and store its SSH password.
   * @param input - the host fields plus its password.
   * @returns the stored host's row.
   */
  @Remote('add')
  async remoteExportAdd(input: RemoteHostAddInput): Promise<RemoteHostRow> {
    const { password, webToken, ...rest } = input
    const record = parseRemoteHostRecord(rest)
    await this.registry.add(record)
    await this.registry.setPassword(record.id, password)
    if (webToken !== undefined && webToken !== '') await this.registry.setWebToken(record.id, webToken)
    return this.rowOf(record, this.connectedIds())
  }

  /**
   * Forget one host, its stored password, and its tunnel.
   * @param id - the host to remove; an unknown id resolves without effect.
   */
  @Remote('delete')
  async remoteExportRemove(id: string): Promise<void> {
    await this.connections.close(id as RemoteHostId)
    await this.registry.remove(id as RemoteHostId)
  }

  /**
   * Open the host's tunnel so its GUI can load. Opening an already-connected
   * host returns the live connection.
   * @param id - the host to connect.
   * @returns the loopback origin the frame loads from.
   */
  @Remote('connect')
  async remoteExportConnect(id: string): Promise<RemoteHostConnection> {
    const record = this.registry.list().find(row => row.id === id)
    if (record === undefined) {
      throw new RemoteError('remote-host/unknown', `no configured host "${id}"`, { id })
    }
    let password: string
    try {
      password = await this.registry.passwordOf(record.id)
    } catch (error: unknown) {
      throw new RemoteError(
        'remote-host/no-password',
        `host "${id}" stores no readable ssh password`,
        { id },
        { cause: error },
      )
    }
    try {
      const connected = await this.connections.open(record, password)
      const origin = `http://127.0.0.1:${String(connected.localPort)}`
      const token = await this.registry.webTokenOf(record.id)
      return {
        id,
        localPort: connected.localPort,
        origin,
        frameUrl: token === undefined ? `${origin}/` : `${origin}/?token=${encodeURIComponent(token)}`,
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      if (/address already in use|EADDRINUSE/u.test(message)) {
        throw new RemoteError('remote-host/port-taken', message, { id, localPort: record.localPort }, { cause: error })
      }
      throw new RemoteError(
        'remote-host/unreachable',
        message,
        { id, host: record.host, port: record.port },
        { cause: error },
      )
    }
  }

  /**
   * Close one host's tunnel. The remote process keeps running.
   * @param id - the host to disconnect; an unconnected id resolves without effect.
   */
  @Remote('disconnect')
  async remoteExportDisconnect(id: string): Promise<void> {
    await this.connections.close(id as RemoteHostId)
  }
}

export default RemoteHostController
