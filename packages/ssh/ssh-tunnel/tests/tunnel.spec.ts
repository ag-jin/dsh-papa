/** The tunnel owns one ssh process, waits for a real listener, and removes its secret on close. */
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SshTunnel } from '../src/tunnel.ts'
import type { TunnelRunner, TunnelChild } from '../src/tunnel.ts'

const directories: string[] = []

async function workspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-tunnel-spec-'))
  directories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

/** Records every spawn and every control command; reports the master as reachable on demand. */
function fakeRunner(reachable: () => boolean): { runner: TunnelRunner; spawns: string[][]; checked: () => boolean } {
  const spawns: string[][] = []
  let didCheck = false
  const child: TunnelChild = {
    pid: 4242,
    kill: vi.fn(() => true),
    once: vi.fn(() => child),
    on: vi.fn(() => child),
  }
  return {
    spawns,
    checked: () => didCheck,
    runner: {
      spawn: (_file, args) => { spawns.push([...args]); return child },
      check: async () => { didCheck = true; return reachable() },
      terminate: async () => {},
    },
  }
}

describe('SshTunnel', () => {
  it('spawns ssh with the forwarded port and reports readiness', async () => {
    const directory = await workspace()
    const fake = fakeRunner(() => true)
    const tunnel = new SshTunnel(
      { host: 'box.example', port: 22, user: 'jin', remotePort: 3080, localPort: 51080 },
      'hunter2',
      { directory, knownHostsPath: join(directory, 'known_hosts'), runner: fake.runner, readyTimeoutMs: 500 },
    )
    await tunnel.open()

    expect(fake.spawns).toHaveLength(1)
    const args = fake.spawns[0]!
    expect(args[args.indexOf('-L') + 1]).toBe('127.0.0.1:51080:127.0.0.1:3080')
    await tunnel.close()
  })

  it('gives up when the master never becomes reachable', async () => {
    const directory = await workspace()
    const fake = fakeRunner(() => false)
    const tunnel = new SshTunnel(
      { host: 'box.example', port: 22, user: 'jin', remotePort: 3080, localPort: 51080 },
      'hunter2',
      { directory, knownHostsPath: join(directory, 'known_hosts'), runner: fake.runner, readyTimeoutMs: 150 },
    )

    await expect(tunnel.open()).rejects.toThrow(/did not become ready/)
    await tunnel.close()
  })

  it('removes the secret even when the master never became ready', async () => {
    const directory = await workspace()
    const fake = fakeRunner(() => false)
    const tunnel = new SshTunnel(
      { host: 'box.example', port: 22, user: 'jin', remotePort: 3080, localPort: 51080 },
      'hunter2',
      { directory, knownHostsPath: join(directory, 'known_hosts'), runner: fake.runner, readyTimeoutMs: 150 },
    )
    await tunnel.open().catch(() => undefined)
    await tunnel.close()

    await expect(stat(join(directory, 'secret'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
