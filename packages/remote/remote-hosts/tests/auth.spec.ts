/**
 * Reading the remote's stored signing secret and minting the cookie its own
 * verifier accepts, including the shapes a real credential store does not have.
 */

import { describe, expect, it } from 'vitest'
import { createHash, createHmac } from 'node:crypto'
import { cookieName, credentialReadCommand, mintSessionCookie, readSigningSecret } from '../src/auth.ts'

/** A credential store in the shape the remote writes. */
const STORE = [
  'version: 1',
  'records:',
  '  client-connection/browser-session:',
  '    kind: grant',
  '    payload:',
  '      version: 1',
  '      secret: 5IAlUQgadgXlQcBmlm-i6ippZCz_N0F1yKJMLY7fc5Q',
  '',
].join('\n')

describe('readSigningSecret', () => {
  it('reads the browser-session secret out of a stored credential document', () => {
    const secret = readSigningSecret(STORE)

    expect(secret).toBeDefined()
    expect(secret).toHaveLength(32)
  })

  it('returns undefined when the record is absent, so the caller degrades to no cookie', () => {
    expect(readSigningSecret('version: 1\nrecords:\n  other/key:\n    kind: grant\n')).toBeUndefined()
  })

  it('returns undefined when the record carries no secret field', () => {
    const withoutSecret = 'version: 1\nrecords:\n  client-connection/browser-session:\n    kind: grant\n    payload:\n      version: 1\n'

    expect(readSigningSecret(withoutSecret)).toBeUndefined()
  })

  it('returns undefined for a secret that decodes to nothing rather than signing with it', () => {
    // An empty quoted scalar decodes to a zero-length key, which would sign a
    // cookie no verifier could accept.
    const emptySecret = STORE.replace('secret: 5IAlUQgadgXlQcBmlm-i6ippZCz_N0F1yKJMLY7fc5Q', 'secret: \"\"')

    expect(readSigningSecret(emptySecret)).toBeUndefined()
  })

  it('returns undefined when the record names no secret at all', () => {
    const noSecret = STORE.replace('      secret: 5IAlUQgadgXlQcBmlm-i6ippZCz_N0F1yKJMLY7fc5Q\n', '')

    expect(readSigningSecret(noSecret)).toBeUndefined()
  })

  it('ignores a secret that belongs to a different record', () => {
    // The session record is absent; another record's secret must not be adopted.
    const otherRecord = [
      'version: 1',
      'records:',
      '  client-connection/other:',
      '    payload:',
      '      secret: bm90LXRoZS1yaWdodC1vbmU',
      '',
    ].join('\n')

    expect(readSigningSecret(otherRecord)).toBeUndefined()
  })
})

describe('mintSessionCookie', () => {
  const secret = Buffer.from('a'.repeat(43), 'base64url')

  it('names the cookie after the authority, as the remote verifier derives it', () => {
    const cookie = mintSessionCookie(secret, '127.0.0.1:51080', 1_700_000_000_000)

    expect(cookie.split('=')[0]).toBe(cookieName('127.0.0.1:51080'))
    expect(cookieName('127.0.0.1:51080')).toBe(
      'dsh-auth-' + createHash('sha256').update('127.0.0.1:51080').digest('base64url'),
    )
  })

  it('signs a payload naming the authority, so a different authority would be refused', () => {
    const cookie = mintSessionCookie(secret, '127.0.0.1:51080', 1_700_000_000_000)
    const [body, signature] = cookie.split('=')[1]!.split('.').slice(1)

    const payload = JSON.parse(Buffer.from(body!, 'base64url').toString('utf8')) as Record<string, unknown>
    expect(payload).toEqual({
      version: 1,
      authority: '127.0.0.1:51080',
      issuedAt: 1_700_000_000_000,
      expiresAt: 1_700_000_000_000 + 30 * 24 * 60 * 60 * 1000,
    })
    // Reproduce the remote's check independently of the code under test.
    const expected = createHmac('sha256', secret).update(body!).digest('base64url')
    expect(signature).toBe(expected)
  })

  it('mints a different cookie for a different authority', () => {
    const one = mintSessionCookie(secret, '127.0.0.1:51080', 1_700_000_000_000)
    const two = mintSessionCookie(secret, '127.0.0.1:51081', 1_700_000_000_000)

    expect(one).not.toBe(two)
  })
})

describe('credentialReadCommand', () => {
  it('expands a leading tilde through the remote shell rather than quoting it literally', () => {
    // A single-quoted `~` stays a directory name and the read finds nothing.
    expect(credentialReadCommand('~/.dsh')).toBe("cat '$HOME/.dsh/.credentials.yaml'")
  })

  it('keeps an absolute home path as written', () => {
    expect(credentialReadCommand('/opt/dsh')).toBe("cat '/opt/dsh/.credentials.yaml'")
  })

  it('quotes a home path containing spaces', () => {
    expect(credentialReadCommand('/opt/my harness')).toBe("cat '/opt/my harness/.credentials.yaml'")
  })

  it('refuses a path that could break out of the quoting', () => {
    expect(credentialReadCommand("/tmp/it's")).toBeUndefined()
    expect(credentialReadCommand('/tmp/two\nlines')).toBeUndefined()
    expect(credentialReadCommand('')).toBeUndefined()
  })
})
