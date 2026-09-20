/** SSH argument construction for one loopback tunnel. Pure: no process, no filesystem. */

/** One remote host as the tunnel owner needs it. */
export interface TunnelTarget {
  /** SSH server hostname or IP literal. */
  host: string
  /** SSH server port. */
  port: number
  /** SSH login user. */
  user: string
  /** Remote `dsh web` port, always reached over the remote's own loopback. */
  remotePort: number
  /** Local loopback port the tunnel listens on. */
  localPort: number
}

/**
 * A login name ssh would parse as an option, or a host carrying anything that
 * separates one argv word from the next, lets a stored record reach ssh's own
 * option parser. Both are refused before they can.
 */
const USER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/
const HOST_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.:-]*$/

function assertPort(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`ssh-tunnel: ${field} must be an integer from 1 through 65535, got ${String(value)}`)
  }
}

/**
 * Build the argv for a multiplexed tunnel that binds one local loopback port to
 * the remote's loopback `dsh web` port.
 * @param target - the remote endpoint and the local port to bind.
 * @param controlPath - control socket of this connection's master.
 * @param knownHostsPath - DSH-owned known-hosts file; a changed key is refused.
 * @returns argv for the `ssh` executable, excluding its own path.
 */
export function tunnelArgs(target: TunnelTarget, controlPath: string, knownHostsPath: string): string[] {
  if (!USER_PATTERN.test(target.user)) {
    throw new Error(`ssh-tunnel: user ${JSON.stringify(target.user)} is not a plain login name`)
  }
  if (!HOST_PATTERN.test(target.host)) {
    throw new Error(`ssh-tunnel: host ${JSON.stringify(target.host)} is not a plain hostname or address`)
  }
  assertPort(target.port, 'port')
  assertPort(target.remotePort, 'remotePort')
  assertPort(target.localPort, 'localPort')
  return [
    '-N',
    '-M', '-S', controlPath,
    '-o', 'ControlPersist=no',
    '-o', 'NumberOfPasswordPrompts=1',
    '-o', 'PreferredAuthentications=password',
    '-o', 'PubkeyAuthentication=no',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', `UserKnownHostsFile=${knownHostsPath}`,
    '-o', 'ForwardAgent=no',
    '-o', 'ExitOnForwardFailure=yes',
    '-o', 'ServerAliveInterval=10',
    '-o', 'ServerAliveCountMax=3',
    '-L', `${String(target.localPort)}:127.0.0.1:${String(target.remotePort)}`,
    '-p', String(target.port),
    `${target.user}@${target.host}`,
  ]
}
