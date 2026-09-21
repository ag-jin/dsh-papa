/** The tunnel owns one ssh process, waits for a real listener, and removes its secret on close. */
import { spawn } from 'node:child_process'
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SshTunnel } from '../src/index.ts'
import { systemRunner } from '../src/index.ts'
import type { TunnelRunner, TunnelChild } from '../src/index.ts'

const directories: string[] = []
const children: TunnelChild[] = []

async function workspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-tunnel-spec-'))
  directories.push(directory)
  return directory
}

afterEach(async () => {
  for (const child of children.splice(0)) child.kill('SIGKILL')
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

/** A real child started through the production seam, with its exit observed from spawn time. */
interface RealChild {
  child: TunnelChild
  /** Resolves on the child's own `exit`, attached before it can emit. */
  exited: Promise<void>
}

/** Start a real child through the production runner and track it for teardown. */
function realChild(command: string): RealChild {
  const child = systemRunner.spawn('sh', ['-c', command], process.env)
  children.push(child)
  const exited = new Promise<void>((resolve) => { child.once('exit', () => { resolve() }) })
  return { child, exited }
}

/**
 * A real child that ignores SIGTERM, signalling readiness only once its trap is
 * installed. Its sleep grandchildren are short-lived, so a SIGKILL here leaves
 * no long-running orphan behind.
 */
async function sigtermIgnoringChild(): Promise<TunnelChild> {
  const child = spawn('sh', ['-c', "trap '' TERM; echo ready; while :; do sleep 0.1; done"], {
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  children.push(child)
  await new Promise<void>((resolve) => { child.stdout.once('data', () => { resolve() }) })
  return child
}

const target = { host: 'box.example', port: 22, user: 'jin', remotePort: 3080, localPort: 51080 }

/**
 * Records every spawn and every control command, reports the master as reachable
 * on demand, and lets a test fire the child's own process events.
 */
function fakeRunner(reachable: () => boolean): {
  runner: TunnelRunner
  spawns: string[][]
  reads: (string | undefined)[]
  emit: (event: string, ...args: unknown[]) => void
} {
  const spawns: string[][] = []
  const reads: (string | undefined)[] = []
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>()
  const child: TunnelChild = {
    pid: 4242,
    exitCode: null,
    signalCode: null,
    kill: vi.fn(() => true),
    once: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      listeners.set(event, [...listeners.get(event) ?? [], listener])
      return child
    }),
    on: vi.fn(() => child),
  }
  return {
    spawns,
    reads,
    emit: (event, ...args) => { for (const listener of listeners.get(event) ?? []) listener(...args) },
    runner: {
      spawn: (_file, args) => { spawns.push([...args]); return child },
      check: async () => reachable(),
      terminate: async () => {},
      read: async () => reads.shift(),
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
    expect(tunnel.localPort).toBe(51080)
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

  it('reports a master that dies before it answers as a readiness failure', async () => {
    const directory = await workspace()
    const fake = fakeRunner(() => false)
    const tunnel = new SshTunnel(
      { host: 'box.example', port: 22, user: 'jin', remotePort: 3080, localPort: 51080 },
      'hunter2',
      { directory, knownHostsPath: join(directory, 'known_hosts'), runner: fake.runner, readyTimeoutMs: 150 },
    )
    const opening = tunnel.open()
    // The child's own spawn failure must not escape as an unhandled rejection;
    // emit only after open() has spawned and attached its listener.
    while (fake.spawns.length === 0) await new Promise(resolve => setTimeout(resolve, 0))
    fake.emit('error', new Error('spawn ssh ENOENT'))

    await expect(opening).rejects.toThrow(/did not become ready/)
    await tunnel.close()
  })

  it('defaults to the production runner when no seam is supplied', async () => {
    const directory = await workspace()
    const tunnel = new SshTunnel(target, 'hunter2', {
      directory,
      knownHostsPath: join(directory, 'known_hosts'),
    })

    expect(tunnel.localPort).toBe(51080)
    await tunnel.close()
  })

  it('refuses to open twice or after close', async () => {
    const directory = await workspace()
    const fake = fakeRunner(() => true)
    const tunnel = new SshTunnel(target, 'hunter2', {
      directory,
      knownHostsPath: join(directory, 'known_hosts'),
      runner: fake.runner,
      readyTimeoutMs: 500,
    })
    await tunnel.open()

    await expect(tunnel.open()).rejects.toThrow(/already open/)

    await tunnel.close()
    await expect(tunnel.open()).rejects.toThrow(/closed/)
  })

  it('still removes the secret when terminating the master fails', async () => {
    const directory = await workspace()
    const fake = fakeRunner(() => true)
    const runner: TunnelRunner = {
      ...fake.runner,
      terminate: async () => { throw new Error('terminate failed') },
    }
    const tunnel = new SshTunnel(target, 'hunter2', {
      directory,
      knownHostsPath: join(directory, 'known_hosts'),
      runner,
      readyTimeoutMs: 500,
    })
    await tunnel.open()

    await tunnel.close()

    await expect(stat(join(directory, 'secret'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('closes an unopened tunnel and tolerates a second close', async () => {
    const directory = await workspace()
    const tunnel = new SshTunnel(target, 'hunter2', {
      directory,
      knownHostsPath: join(directory, 'known_hosts'),
      runner: fakeRunner(() => true).runner,
    })

    await tunnel.close()
    await tunnel.close()

    expect(tunnel.localPort).toBe(51080)
  })

  it('resolves close when the master already exited', async () => {
    const directory = await workspace()
    const { child, exited } = realChild('exit 0')
    await exited
    const tunnel = new SshTunnel(target, 'hunter2', {
      directory,
      knownHostsPath: join(directory, 'known_hosts'),
      // The production terminate against a child that already exited: without
      // the already-exited guard this never settles and close() hangs forever.
      runner: { ...systemRunner, spawn: () => child, check: async () => true },
      readyTimeoutMs: 500,
    })
    await tunnel.open()

    const outcome = await Promise.race([
      tunnel.close().then(() => 'closed'),
      new Promise(resolve => setTimeout(() => { resolve('hung') }, 2_000)),
    ])

    expect(outcome).toBe('closed')
  })
})

describe('systemRunner', () => {
  it('spawns a real process through the production seam', async () => {
    const { child, exited } = realChild('exit 7')

    await exited

    expect(child.pid).toBeTypeOf('number')
    expect(child.exitCode).toBe(7)
  })

  it('terminates a running master and resolves once it exited', async () => {
    const { child, exited } = realChild('exec sleep 30')

    await systemRunner.terminate(child, 5_000)
    await exited

    expect(child.exitCode !== null || child.signalCode !== null).toBe(true)
  })

  it('runs a remote command through the production seam and returns its output', async () => {
    const bin = await mkdtemp(join(tmpdir(), 'dsh-ssh-read-'))
    const previousPath = process.env.PATH
    try {
      // A shim stands in for ssh and echoes what it was asked to run.
      await writeFile(join(bin, 'ssh'), '#!/bin/sh\necho "ran: $*"\n', { mode: 0o755 })
      await chmod(join(bin, 'ssh'), 0o755)
      process.env.PATH = `${bin}:${previousPath ?? ''}`

      const output = await systemRunner.read(
        join(bin, 'master'),
        { host: 'box.example', port: 2222, user: 'jin', remotePort: 3080, localPort: 51080 },
        'cat /remote/creds',
        5_000,
      )

      expect(output).toContain('ran:')
      expect(output).toContain('cat /remote/creds')
      // The read rides the named control socket and the target's own port.
      expect(output).toContain('-S')
      expect(output).toContain('2222')
    } finally {
      if (previousPath === undefined) delete process.env.PATH
      else process.env.PATH = previousPath
      await rm(bin, { recursive: true, force: true })
    }
  })

  it('reports a failed remote command as undefined rather than throwing', async () => {
    const bin = await mkdtemp(join(tmpdir(), 'dsh-ssh-read-fail-'))
    const previousPath = process.env.PATH
    try {
      await writeFile(join(bin, 'ssh'), '#!/bin/sh\nexit 1\n', { mode: 0o755 })
      await chmod(join(bin, 'ssh'), 0o755)
      process.env.PATH = `${bin}:${previousPath ?? ''}`

      // A nonexistent remote file exits non-zero, which the caller reads as
      // "no secret here" rather than an error to surface.
      expect(await systemRunner.read(
        join(bin, 'master'),
        { host: 'box.example', port: 2222, user: 'jin', remotePort: 3080, localPort: 51080 },
        'cat /absent',
        5_000,
      )).toBeUndefined()
    } finally {
      if (previousPath === undefined) delete process.env.PATH
      else process.env.PATH = previousPath
      await rm(bin, { recursive: true, force: true })
    }
  })

  it('returns immediately for a master that already exited', async () => {
    const { child, exited } = realChild('exit 0')
    await exited

    const outcome = await Promise.race([
      systemRunner.terminate(child, 5_000).then(() => 'returned'),
      new Promise(resolve => setTimeout(() => { resolve('hung') }, 1_500)),
    ])

    expect(outcome).toBe('returned')
  })

  it('escalates to SIGKILL when the master ignores SIGTERM', async () => {
    // The trap must be installed before the signal arrives, so readiness is
    // reported from inside the shell rather than assumed from spawn.
    const child = await sigtermIgnoringChild()
    const exited = new Promise<void>((resolve) => { child.once('exit', () => { resolve() }) })

    await systemRunner.terminate(child, 300)
    await exited

    expect(child.signalCode).toBe('SIGKILL')
  })

  it('reports the control socket reachable only when ssh succeeds', async () => {
    const directory = await workspace()
    const bin = join(directory, 'bin')
    const empty = join(directory, 'empty')
    await mkdir(bin, { recursive: true })
    await mkdir(empty, { recursive: true })
    const previousPath = process.env.PATH
    try {
      // A shim ahead of the real ssh keeps these checks off the network.
      await writeFile(join(bin, 'ssh'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
      await chmod(join(bin, 'ssh'), 0o755)
      process.env.PATH = `${bin}:${previousPath ?? ''}`
      expect(await systemRunner.check(join(directory, 'master'), target, 5_000)).toBe(true)

      await writeFile(join(bin, 'ssh'), '#!/bin/sh\nexit 1\n')
      expect(await systemRunner.check(join(directory, 'master'), target, 5_000)).toBe(false)

      // No ssh anywhere on PATH: the spawn error is an unreachable master.
      process.env.PATH = empty
      expect(await systemRunner.check(join(directory, 'master'), target, 5_000)).toBe(false)
    } finally {
      if (previousPath === undefined) delete process.env.PATH
      else process.env.PATH = previousPath
    }
  })

  it('runs a remote command over the master rather than opening a second connection', async () => {
    const directory = await workspace()
    const fake = fakeRunner(() => true)
    fake.reads.push('version: 1\nrecords:\n')
    const tunnel = new SshTunnel(
      { host: 'box.example', port: 2222, user: 'jin', remotePort: 3080, localPort: 51080 },
      'hunter2',
      { directory, knownHostsPath: join(directory, 'known_hosts'), runner: fake.runner, readyTimeoutMs: 500 },
    )
    await tunnel.open()

    expect(await tunnel.read("cat '$HOME/.dsh/.credentials.yaml'", 5_000)).toBe('version: 1\nrecords:\n')
    // One spawn: the read rode the master the tunnel already opened.
    expect(fake.spawns).toHaveLength(1)
  })

  it('reports a failed read as undefined rather than throwing', async () => {
    const directory = await workspace()
    const fake = fakeRunner(() => true)
    fake.reads.push(undefined)
    const tunnel = new SshTunnel(
      { host: 'box.example', port: 2222, user: 'jin', remotePort: 3080, localPort: 51080 },
      'hunter2',
      { directory, knownHostsPath: join(directory, 'known_hosts'), runner: fake.runner, readyTimeoutMs: 500 },
    )
    await tunnel.open()

    expect(await tunnel.read('cat /absent', 5_000)).toBeUndefined()
  })

  it('refuses to read before the tunnel is open', async () => {
    const directory = await workspace()
    const fake = fakeRunner(() => true)
    fake.reads.push('never returned')
    const tunnel = new SshTunnel(
      { host: 'box.example', port: 2222, user: 'jin', remotePort: 3080, localPort: 51080 },
      'hunter2',
      { directory, knownHostsPath: join(directory, 'known_hosts'), runner: fake.runner, readyTimeoutMs: 500 },
    )

    // No master exists yet, so there is no authenticated connection to reuse.
    expect(await tunnel.read('cat /anything', 5_000)).toBeUndefined()
  })

  it('refuses to read after the tunnel is closed', async () => {
    const directory = await workspace()
    const fake = fakeRunner(() => true)
    fake.reads.push('stale')
    const tunnel = new SshTunnel(
      { host: 'box.example', port: 2222, user: 'jin', remotePort: 3080, localPort: 51080 },
      'hunter2',
      { directory, knownHostsPath: join(directory, 'known_hosts'), runner: fake.runner, readyTimeoutMs: 500 },
    )
    await tunnel.open()
    await tunnel.close()

    expect(await tunnel.read('cat /anything', 5_000)).toBeUndefined()
  })
})
