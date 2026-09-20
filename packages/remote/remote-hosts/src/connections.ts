/**
 * Live tunnels, one per connected host, and the loopback port each one
 * reports. Opening an already-connected host returns the live connection, so
 * a second click in the host switcher cannot leak a second tunnel.
 * @module @deepseek-ai/dsh-remote-hosts/src/connections
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SshTunnel } from '@deepseek-ai/dsh-ssh-tunnel'
import type { SshTunnelOptions, TunnelTarget } from '@deepseek-ai/dsh-ssh-tunnel'
import type { RemoteHostId, RemoteHostRecord } from './spec.ts'

/** One connected host: its live tunnel and the loopback port that tunnel listens on. */
export interface ConnectedHost {
  /** The connected host's id. */
  readonly id: RemoteHostId
  /** The local loopback port the tunnel listens on. */
  readonly localPort: number
}

/** One live connection and the scratch directory its tunnel owns. */
interface LiveConnection {
  readonly tunnel: SshTunnel
  readonly directory: string
}

/**
 * Owns every live tunnel. Each connection gets a fresh temporary directory
 * holding the control socket, the DSH-owned known-hosts file, and the askpass
 * handoff; closing it removes the directory, so a long-lived Host leaves no
 * per-connection residue behind.
 */
export class RemoteHostConnections {
  private readonly live = new Map<RemoteHostId, LiveConnection>()

  /**
   * @param options - per-tunnel options forwarded to every {@link SshTunnel};
   * tests supply a runner here, production passes none.
   */
  constructor(private readonly options: Partial<SshTunnelOptions> = {}) {}

  /**
   * The connected hosts and their local loopback ports.
   * @returns one entry per live tunnel, in open order.
   */
  list(): readonly ConnectedHost[] {
    return [...this.live.entries()].map(([id, connection]) => ({ id, localPort: connection.tunnel.localPort }))
  }

  /**
   * Open one host's tunnel, or return its live connection. The connection is
   * published only after the tunnel reports ready, so a listed host always
   * has a listening port.
   * @param record - the configured host.
   * @param password - the host's SSH password.
   * @returns the connected host and its local loopback port.
   */
  async open(record: RemoteHostRecord, password: string): Promise<ConnectedHost> {
    const existing = this.live.get(record.id)
    if (existing !== undefined) return { id: record.id, localPort: existing.tunnel.localPort }

    const directory = await mkdtemp(join(tmpdir(), 'dsh-remote-host-'))
    const target: TunnelTarget = {
      host: record.host,
      port: record.port,
      user: record.user,
      remotePort: record.remotePort,
      localPort: record.localPort,
    }
    const tunnel = new SshTunnel(target, password, {
      ...this.options,
      directory,
      knownHostsPath: join(directory, 'known_hosts'),
    })
    try {
      await tunnel.open()
    } catch (error: unknown) {
      // A failed open owns no published state: tear the master down and
      // remove the scratch directory before the failure reaches the caller.
      await tunnel.close()
      await rm(directory, { recursive: true, force: true })
      throw error
    }
    this.live.set(record.id, { tunnel, directory })
    return { id: record.id, localPort: tunnel.localPort }
  }

  /**
   * Close one host's tunnel and remove its scratch directory. Closing an
   * unconnected host is a no-op.
   * @param id - the host to disconnect.
   */
  async close(id: RemoteHostId): Promise<void> {
    const connection = this.live.get(id)
    this.live.delete(id)
    if (connection === undefined) return
    await connection.tunnel.close()
    await rm(connection.directory, { recursive: true, force: true })
  }

  /** Close every tunnel; the service disposer calls this. */
  async closeAll(): Promise<void> {
    await Promise.all([...this.live.keys()].map(id => this.close(id)))
  }
}
