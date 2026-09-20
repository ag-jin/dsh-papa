/** SSH argument construction forwards one loopback port and refuses argv-shaped input. */
import { describe, expect, it } from 'vitest'
import { tunnelArgs } from '../src/argv.ts'

const target = { host: 'box.example', port: 30028, user: 'jin', remotePort: 3080, localPort: 51080 }

describe('tunnelArgs', () => {
  it('binds loopback explicitly, so the tunnel cannot be published by a GatewayPorts setting', () => {
    const args = tunnelArgs(target, '/tmp/dsh-tunnel/master', '/tmp/dsh-tunnel/known_hosts')
    expect(args[args.indexOf('-L') + 1]).toBe('127.0.0.1:51080:127.0.0.1:3080')
  })

  it('never emits the two-field -L form, whose bind address follows GatewayPorts', () => {
    const args = tunnelArgs(target, '/tmp/m', '/tmp/kh')
    const spec = args[args.indexOf('-L') + 1]!
    expect(spec.split(':')).toHaveLength(4)
    expect(spec.startsWith('127.0.0.1:')).toBe(true)
  })

  it('carries the ssh port and the login target', () => {
    const args = tunnelArgs(target, '/tmp/m', '/tmp/kh')
    expect(args[args.indexOf('-p') + 1]).toBe('30028')
    expect(args.at(-1)).toBe('jin@box.example')
  })

  it('runs no remote command and keeps the master for the process lifetime', () => {
    const args = tunnelArgs(target, '/tmp/m', '/tmp/kh')
    expect(args).toContain('-N')
    expect(args[args.indexOf('-o') + 1]).toBe('ControlPersist=no')
  })

  it('verifies host keys against the DSH-owned file and accepts only a new key', () => {
    const args = tunnelArgs(target, '/tmp/m', '/tmp/kh')
    expect(args).toContain('StrictHostKeyChecking=accept-new')
    expect(args).toContain('UserKnownHostsFile=/tmp/kh')
  })

  it('authenticates by password only', () => {
    const args = tunnelArgs(target, '/tmp/m', '/tmp/kh')
    expect(args).toContain('PreferredAuthentications=password')
    expect(args).toContain('PubkeyAuthentication=no')
  })

  it('fails the connection when the forward cannot bind', () => {
    expect(tunnelArgs(target, '/tmp/m', '/tmp/kh')).toContain('ExitOnForwardFailure=yes')
  })

  it('refuses a login name that ssh would read as an option', () => {
    expect(() => tunnelArgs({ ...target, user: '-oProxyCommand=evil' }, '/tmp/m', '/tmp/kh'))
      .toThrow(/user/)
  })

  it('refuses a host carrying a separator or whitespace', () => {
    expect(() => tunnelArgs({ ...target, host: 'box.example -o X' }, '/tmp/m', '/tmp/kh'))
      .toThrow(/host/)
  })

  it('refuses a port outside the TCP range', () => {
    expect(() => tunnelArgs({ ...target, port: 70000 }, '/tmp/m', '/tmp/kh')).toThrow(/port/)
    expect(() => tunnelArgs({ ...target, localPort: 0 }, '/tmp/m', '/tmp/kh')).toThrow(/localPort/)
  })
})
