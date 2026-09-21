/**
 * The cookie a remote Harness expects, minted from the signing secret stored in
 * that machine's own Harness home. Reading the secret over the tunnel's already
 * authenticated connection costs the operator nothing beyond the SSH
 * credentials they already gave, so no launch token is ever pasted.
 * @module @deepseek-ai/dsh-remote-hosts/src/auth
 */

import { createHash, createHmac } from 'node:crypto'

/** The remote Harness home whose credential store holds the signing secret. */
export const DEFAULT_REMOTE_HOME = '~/.dsh'

/** Home variable the remote shell expands; a leading `~` is expanded here into this. */
const HOME_PREFIX = '~'

/** Credential record key owning the browser-session signing secret. */
const AUTH_RECORD_KEY = 'client-connection/browser-session'

/** Cookie payload format this client mints, matching the remote's own reader. */
const COOKIE_PAYLOAD_VERSION = 1

/** Header name prefix of the authority-bound session cookie. */
const COOKIE_PREFIX = 'dsh-auth-'

/** Absolute lifetime of a minted cookie. */
const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Read the browser-session signing secret out of a remote credential store.
 *
 * The file is the same `version`/`records` document the credential provider
 * writes: one record per key, each with a `kind` and a `payload`. Only the
 * browser-session secret is read; this parser exists rather than a YAML
 * dependency because the document's shape is fixed and narrow.
 * @param source - the credential store's text.
 * @returns the decoded secret, or undefined when the record is absent or unreadable.
 */
export function readSigningSecret(source: string): Buffer | undefined {
  const keyIndex = source.indexOf(`${AUTH_RECORD_KEY}:`)
  if (keyIndex < 0) return undefined
  const secretMatch = /^\s+secret:\s*(\S+)\s*$/mu.exec(source.slice(keyIndex))
  const encoded = secretMatch?.[1]
  if (encoded === undefined) return undefined
  const secret = Buffer.from(encoded, 'base64url')
  return secret.length === 0 ? undefined : secret
}

/**
 * Mint the session cookie one authority accepts.
 *
 * The remote verifies the cookie's signature over a payload naming the
 * authority the browser asked about, so an authority the remote never signed
 * for would be refused; the caller passes the authority the page actually uses.
 * @param secret - the remote's browser-session signing secret.
 * @param authority - the `host:port` the browser reaches the remote through.
 * @param now - issue time in epoch milliseconds.
 * @returns the `name=value` cookie pair to send back to the browser.
 */
export function mintSessionCookie(secret: Buffer, authority: string, now: number): string {
  const payload = {
    version: COOKIE_PAYLOAD_VERSION,
    authority,
    issuedAt: now,
    expiresAt: now + COOKIE_MAX_AGE_MS,
  }
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const signature = createHmac('sha256', secret).update(body).digest().toString('base64url')
  return `${cookieName(authority)}=v1.${body}.${signature}`
}

/**
 * The cookie name one authority expects: the prefix plus a digest of the
 * authority, matching the remote's own derivation.
 * @param authority - the `host:port` the browser reaches the remote through.
 * @returns the cookie name.
 */
export function cookieName(authority: string): string {
  return COOKIE_PREFIX + createHash('sha256').update(authority).digest().toString('base64url')
}

/**
 * The shell command that reads a remote Harness home's credential store.
 *
 * A leading `~` becomes `$HOME`: the remote shell expands a variable inside the
 * single quotes that protect the rest of the path, while a quoted `~` would
 * stay a literal directory name and the read would find nothing. The path is
 * single-quoted because it may contain spaces, and a path holding a single
 * quote is refused rather than escaped, so no command can be injected.
 * @param home - the remote Harness home, `~` included.
 * @returns the command to run over the tunnel, or undefined when the path is unusable.
 */
export function credentialReadCommand(home: string): string | undefined {
  if (home === '' || home.includes("'") || home.includes('\n')) return undefined
  const expanded = home.startsWith(HOME_PREFIX) ? `$HOME${home.slice(HOME_PREFIX.length)}` : home
  return `cat '${expanded}/.credentials.yaml'`
}
