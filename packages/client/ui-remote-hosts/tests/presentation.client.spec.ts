/**
 * The switcher's pure presentation: how a refusal reads, and what the add
 * form's values hold once parsed.
 */

import { describe, expect, it } from 'vitest'
import { en, type RemoteHostsLocaleKey } from '../src/client/locales.ts'
import { draftOf, EMPTY_FORM, failureText, parsePort, type RemoteHostFormValues, type Translate } from '../src/client/presentation.ts'

// The seat the panel receives also answers the shared common vocabulary, which
// this dictionary does not carry; the cast keeps the stub to its own keys.
const t = ((key: RemoteHostsLocaleKey): string => en[key]) as unknown as Translate

const COMPLETE: RemoteHostFormValues = {
  label: ' Build box ', host: ' box.example ', user: ' jin ', password: 'secret', port: '22', remotePort: '3080', localPort: '51080',
}

describe('parsePort', () => {
  it('reads a decimal port inside the TCP range and refuses everything else', () => {
    expect(parsePort('22')).toBe(22)
    expect(parsePort('65535')).toBe(65_535)
    // Not digits, empty, out of range, and beyond five digits.
    expect(parsePort('box')).toBeNull()
    expect(parsePort('')).toBeNull()
    expect(parsePort('22.5')).toBeNull()
    expect(parsePort(' 22')).toBeNull()
    expect(parsePort('0')).toBeNull()
    expect(parsePort('70000')).toBeNull()
    expect(parsePort('123456')).toBeNull()
  })
})

describe('draftOf', () => {
  it('trims the identity fields and keeps the password as typed', () => {
    expect(draftOf(COMPLETE)).toEqual({
      label: 'Build box', host: 'box.example', user: 'jin', port: 22, remotePort: 3080, localPort: 51080, password: 'secret',
    })
  })

  it('stays incomplete while any field is missing', () => {
    expect(draftOf(EMPTY_FORM)).toBeNull()
    expect(draftOf({ ...COMPLETE, label: ' ' })).toBeNull()
    expect(draftOf({ ...COMPLETE, host: '' })).toBeNull()
    expect(draftOf({ ...COMPLETE, user: ' ' })).toBeNull()
    expect(draftOf({ ...COMPLETE, password: '' })).toBeNull()
  })

  it('stays incomplete while any port is unusable', () => {
    expect(draftOf({ ...COMPLETE, port: '0' })).toBeNull()
    expect(draftOf({ ...COMPLETE, remotePort: '70000' })).toBeNull()
    expect(draftOf({ ...COMPLETE, localPort: 'ssh' })).toBeNull()
  })
})

describe('failureText', () => {
  it('words a refused connect by the Host code, and any unlisted code as the SSH failure', () => {
    expect(failureText({ action: 'connect', code: 'remote-host/unknown' }, t)).toBe(en.unknownHost)
    expect(failureText({ action: 'connect', code: 'remote-host/no-password' }, t)).toBe(en.noPassword)
    expect(failureText({ action: 'connect', code: 'remote-host/port-taken' }, t)).toBe(en.portTaken)
    expect(failureText({ action: 'connect', code: 'remote-host/unreachable' }, t)).toBe(en.unreachable)
    expect(failureText({ action: 'connect', code: 'gateway/internal' }, t)).toBe(en.unreachable)
    expect(failureText({ action: 'connect' }, t)).toBe(en.unreachable)
  })

  it('words every other refusal by what was being done', () => {
    expect(failureText({ action: 'add', code: 'gateway/internal' }, t)).toBe(en.addFailed)
    expect(failureText({ action: 'remove', code: 'gateway/bad-request' }, t)).toBe(en.removeFailed)
    expect(failureText({ action: 'disconnect', code: 'gateway/internal' }, t)).toBe(en.disconnectFailed)
  })
})
