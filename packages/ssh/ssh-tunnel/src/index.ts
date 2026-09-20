/**
 * The loopback SSH tunnel package's public face: argument construction, the
 * askpass handoff, and one tunnel's lifecycle. The remote-host registry composes
 * them into live connections.
 * @module @deepseek-ai/dsh-ssh-tunnel
 */

export { tunnelArgs, type TunnelTarget } from './argv.ts'
export { materializeAskpass, type AskpassHandoff } from './askpass.ts'
export { SshTunnel, systemRunner, type SshTunnelOptions, type TunnelChild, type TunnelRunner } from './tunnel.ts'
