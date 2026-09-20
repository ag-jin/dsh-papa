/**
 * The configured remote hosts: the record list is written through the opened
 * remote-host domain, and each host's SSH password is a separate credential
 * record under this package's scope, so no durable host record carries a
 * secret.
 * @module @deepseek-ai/dsh-remote-hosts/src/registry
 */

import { credentialKey } from '@deepseek-ai/dsh-credentials'
import type { CredentialProvider, CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { parseRemoteHostRecord } from './spec.ts'
import type { RemoteHostId, RemoteHostRecord } from './spec.ts'

/** Credential scope owning every remote host's password record. */
export const REMOTE_HOST_CREDENTIAL_SCOPE = 'remote-host-ssh'

/** Credential scope owning every remote host's Web access-token record. */
export const REMOTE_HOST_TOKEN_CREDENTIAL_SCOPE = 'remote-host-web'

/** Payload format version of one stored secret record. */
const PASSWORD_RECORD_VERSION = 1

/**
 * Recover one secret from a stored `grant` record. A record of another kind,
 * or one whose payload this version does not know, fails loud rather than
 * reading as "no secret stored" and sending the operator to fix the wrong
 * thing.
 * @param record - the stored record, if any.
 * @param field - the payload field naming the secret.
 * @param label - the secret's name in diagnostics.
 * @returns the secret, or `undefined` while no record is stored.
 */
function readSecret(record: CredentialRecord | undefined, field: string, label: string): string | undefined {
  if (record === undefined) return undefined
  if (record.kind !== 'grant' || typeof record.payload !== 'object' || record.payload === null) {
    throw new Error(`remote-hosts: ${label} record has an unsupported format`)
  }
  const payload = record.payload as Record<string, unknown>
  const value = payload[field]
  if (payload.version !== PASSWORD_RECORD_VERSION || typeof value !== 'string' || value === '') {
    throw new Error(`remote-hosts: ${label} record has an invalid payload`)
  }
  return value
}

/**
 * Recover the SSH password from a stored `grant` record.
 * @param record - the stored record, if any.
 * @returns the password, or `undefined` while no record is stored.
 */
function readPassword(record: CredentialRecord | undefined): string | undefined {
  return readSecret(record, 'password', 'ssh password')
}

/**
 * The configured remote hosts and their secrets. Records hold no password: the
 * secret lives in `ctx.credentials` under a `grant` record per host.
 */
export class RemoteHostRegistry {
  private records: RemoteHostRecord[] = []

  /**
   * @param credentials - persistent credential provider holding each host's SSH password.
   * @param storage - the opened remote-host domain.
   */
  constructor(
    private readonly credentials: CredentialProvider,
    private readonly storage: RemoteHostStorage,
  ) {}

  /**
   * The configured hosts, in display order.
   * @returns the loaded records, in stored order.
   */
  list(): readonly RemoteHostRecord[] { return this.records }

  /**
   * Store one host. A duplicate id replaces the existing record.
   * @param value - the record to store; revalidated at the durable boundary.
   */
  async add(value: RemoteHostRecord): Promise<void> {
    const record = parseRemoteHostRecord(value)
    const others = this.records.filter(existing => existing.id !== record.id)
    await this.storage.write([...others, record])
    this.records = [...others, record]
  }

  /**
   * Forget one host, its stored secrets included.
   * @param id - the host to remove.
   */
  async remove(id: RemoteHostId): Promise<void> {
    await this.storage.write(this.records.filter(record => record.id !== id))
    this.records = this.records.filter(record => record.id !== id)
    await this.credentials.deleteRecord(credentialKey(REMOTE_HOST_CREDENTIAL_SCOPE, id))
    await this.credentials.deleteRecord(credentialKey(REMOTE_HOST_TOKEN_CREDENTIAL_SCOPE, id))
  }

  /**
   * The host's SSH password.
   * @param id - the host to read.
   * @returns the stored password.
   */
  async passwordOf(id: RemoteHostId): Promise<string> {
    const record = await this.credentials.readRecord(credentialKey(REMOTE_HOST_CREDENTIAL_SCOPE, id))
    const password = readPassword(record)
    if (password === undefined) {
      throw new Error(`remote-hosts: no ssh password is stored for host ${JSON.stringify(id)}`)
    }
    return password
  }

  /**
   * Replace the stored password for one host.
   * @param id - the host whose password to replace.
   * @param password - the non-empty replacement password.
   */
  async setPassword(id: RemoteHostId, password: string): Promise<void> {
    await this.credentials.modifyRecord(credentialKey(REMOTE_HOST_CREDENTIAL_SCOPE, id), () => Promise.resolve({
      kind: 'grant',
      payload: { version: PASSWORD_RECORD_VERSION, password },
    }))
  }

  /**
   * The remote Harness's Web access token, when the operator stored one.
   *
   * The remote's own Web server authenticates its root request with a launch
   * token, so the frame cannot render the remote GUI until that token is
   * exchanged on the tunnel authority. A host without one still connects, and
   * its frame reports the remote's own refusal.
   * @param id - the host to read.
   * @returns the stored token, or `undefined` while none is stored.
   */
  async webTokenOf(id: RemoteHostId): Promise<string | undefined> {
    return readSecret(
      await this.credentials.readRecord(credentialKey(REMOTE_HOST_TOKEN_CREDENTIAL_SCOPE, id)),
      'token',
      'web token',
    )
  }

  /**
   * Replace the stored Web access token for one host.
   * @param id - the host whose token to replace.
   * @param token - the non-empty replacement token.
   */
  async setWebToken(id: RemoteHostId, token: string): Promise<void> {
    await this.credentials.modifyRecord(credentialKey(REMOTE_HOST_TOKEN_CREDENTIAL_SCOPE, id), () => Promise.resolve({
      kind: 'grant',
      payload: { version: PASSWORD_RECORD_VERSION, token },
    }))
  }

  /**
   * Load every stored host.
   * @returns the loaded records, in stored order.
   */
  async load(): Promise<readonly RemoteHostRecord[]> {
    const stored = await this.storage.read()
    this.records = stored.map(parseRemoteHostRecord)
    return this.records
  }
}

/** The domain handle the registry writes through; the Cordis service supplies it. */
export interface RemoteHostStorage {
  /** Read every stored record. */
  read(): Promise<unknown[]>
  /** Replace the stored record set durably. */
  write(records: readonly RemoteHostRecord[]): Promise<void>
}
