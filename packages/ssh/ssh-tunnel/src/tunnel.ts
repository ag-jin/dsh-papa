/** One loopback SSH tunnel: spawn the master, wait for it, tear it down. */

import { spawn as spawnProcess, execFile } from 'node:child_process'
import { join } from 'node:path'
import { materializeAskpass, type AskpassHandoff } from './askpass.ts'
import { tunnelArgs, type TunnelTarget } from './argv.ts'

const SSH_EXECUTABLE = 'ssh'
const READY_POLL_MS = 250

/** The child process surface this module uses. */
export interface TunnelChild {
  readonly pid?: number | undefined
  /** Set once the process exits; null while it still runs. */
  readonly exitCode?: number | null | undefined
  /** Set when a signal ended the process; null while it still runs. */
  readonly signalCode?: NodeJS.Signals | null | undefined
  kill(signal?: NodeJS.Signals): boolean
  once(event: string, listener: (...args: unknown[]) => void): unknown
  on(event: string, listener: (...args: unknown[]) => void): unknown
}

/**
 * Whether a child has already exited. Node assigns `exitCode`/`signalCode`
 * before emitting `exit`, so a listener attached after the fact never fires.
 * @param child - the child to probe.
 * @returns true when the process has already exited.
 */
function hasExited(child: TunnelChild): boolean {
  return child.exitCode != null || child.signalCode != null
}

/**
 * Every process and command this owner runs. Tests replace it; production uses
 * the real implementation below.
 */
export interface TunnelRunner {
  /** Start the multiplexed master. */
  spawn(file: string, args: string[], env: NodeJS.ProcessEnv): TunnelChild
  /** Whether the master's control socket still answers. */
  check(controlPath: string, target: TunnelTarget, timeoutMs: number): Promise<boolean>
  /** Terminate the master. */
  terminate(child: TunnelChild, timeoutMs: number): Promise<void>
  /**
   * Run one command on the remote, reusing the master's authenticated
   * connection rather than opening a second one.
   * @param controlPath - the master's control socket.
   * @param target - the remote endpoint the master is connected to.
   * @param command - the command to run.
   * @param timeoutMs - how long the command may take.
   * @returns the command's stdout, or undefined when it failed.
   */
  read(
    controlPath: string,
    target: TunnelTarget,
    command: string,
    timeoutMs: number,
  ): Promise<string | undefined>
}

/** Injectable dependencies and deadlines for one tunnel. */
export interface SshTunnelOptions {
  /** Directory this tunnel owns; holds the control socket, known hosts, and secret. */
  directory: string
  /** DSH-owned known-hosts file; a changed key is refused. */
  knownHostsPath: string
  /** Process seam; omit for the real implementation. */
  runner?: TunnelRunner
  /** How long to wait for the master to answer its control socket. */
  readyTimeoutMs?: number
}

/** Production process seam: system OpenSSH over `node:child_process`. */
export const systemRunner: TunnelRunner = {
  spawn: (file, args, env) => spawnProcess(file, args, { env, stdio: ['ignore', 'ignore', 'pipe'] }),
  async check(controlPath, target, timeoutMs) {
    return await new Promise<boolean>((resolve) => {
      execFile(
        SSH_EXECUTABLE,
        ['-S', controlPath, '-O', 'check', `${target.user}@${target.host}`],
        { timeout: timeoutMs },
        (error) => { resolve(error === null) },
      )
    })
  },
  async read(controlPath, target, command, timeoutMs) {
    return await new Promise<string | undefined>((resolve) => {
      execFile(
        SSH_EXECUTABLE,
        ['-S', controlPath, '-p', String(target.port), `${target.user}@${target.host}`, command],
        { timeout: timeoutMs, maxBuffer: 1024 * 1024 },
        (error, stdout) => { resolve(error === null ? stdout : undefined) },
      )
    })
  },
  async terminate(child, timeoutMs) {
    // A child that already exited emits no further `exit`, so awaiting a fresh
    // listener here would never settle and would hang every caller of close().
    if (hasExited(child)) return
    const exited = new Promise<void>((resolve) => { child.once('exit', () => { resolve() }) })
    child.kill('SIGTERM')
    const timer = setTimeout(() => { child.kill('SIGKILL') }, timeoutMs)
    await exited
    clearTimeout(timer)
  },
}

/**
 * One tunnel. `open` resolves only after the master answers, so a caller that
 * proceeds has a listening local port.
 */
export class SshTunnel {
  private child: TunnelChild | undefined
  private askpass: AskpassHandoff | undefined
  private closed = false
  private readonly runner: TunnelRunner
  private readonly readyTimeoutMs: number
  private readonly controlPath: string

  /** @param target - remote endpoint and local port. */
  constructor(
    private readonly target: TunnelTarget,
    private readonly password: string,
    private readonly options: SshTunnelOptions,
  ) {
    this.runner = options.runner ?? systemRunner
    this.readyTimeoutMs = options.readyTimeoutMs ?? 20_000
    this.controlPath = join(options.directory, 'master')
  }

  /** The local loopback port this tunnel binds. */
  get localPort(): number { return this.target.localPort }

  /**
   * Run one command on the remote over this tunnel's authenticated master.
   *
   * The master already holds a verified connection, so a read costs no second
   * credential exchange: the same OpenSSH multiplexing that carries the
   * forwarded port carries this command.
   * @param command - the command to run on the remote.
   * @param timeoutMs - how long the command may take.
   * @returns the command's stdout, or undefined when it failed or the tunnel is closed.
   */
  async read(command: string, timeoutMs: number): Promise<string | undefined> {
    if (this.closed || this.child === undefined) return undefined
    return await this.runner.read(this.controlPath, this.target, command, timeoutMs)
  }

  /**
   * Start the master and wait until it answers, so the returned tunnel has a
   * listening port.
   */
  async open(): Promise<void> {
    if (this.closed) throw new Error('ssh-tunnel: tunnel is closed')
    if (this.child !== undefined) throw new Error('ssh-tunnel: tunnel is already open')
    this.askpass = await materializeAskpass(this.options.directory, this.password)
    const args = tunnelArgs(this.target, this.controlPath, this.options.knownHostsPath)
    const env = { ...process.env, ...this.askpass.env() }
    const child = this.runner.spawn(SSH_EXECUTABLE, args, env)
    this.child = child
    // A master that dies early never becomes reachable; the poll below reports it.
    child.once('error', () => undefined)
    const deadline = Date.now() + this.readyTimeoutMs
    while (Date.now() < deadline) {
      if (await this.runner.check(this.controlPath, this.target, 2_000)) return
      await new Promise(resolve => setTimeout(resolve, READY_POLL_MS))
    }
    throw new Error(
      `ssh-tunnel: ${this.target.user}@${this.target.host}:${String(this.target.port)} did not become ready within ${String(this.readyTimeoutMs)} ms`,
    )
  }

  /** Terminate the master and remove the secret; safe to call twice. */
  async close(): Promise<void> {
    this.closed = true
    const child = this.child
    this.child = undefined
    if (child !== undefined) await this.runner.terminate(child, 5_000).catch(() => undefined)
    const askpass = this.askpass
    this.askpass = undefined
    if (askpass !== undefined) await askpass.dispose()
  }
}
