/**
 * The remote-host domain declaration and its record validation. The zod
 * schema validates the shipped format at the durability boundary and brands
 * the record id; the `defineDomain` spec is what the Cordis service opens
 * over `ctx.storageDomain`.
 * @module @deepseek-ai/dsh-remote-hosts/src/spec
 */

import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { Branded } from '@deepseek-ai/dsh-brand'
import { isCredentialKeySegment } from '@deepseek-ai/dsh-credentials'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

/** Nominal identity of one configured remote host. */
export type RemoteHostId = Branded<'RemoteHostId'>

/**
 * Id schema at the durable boundary. A record id doubles as the segment of
 * the host's credential key, so it must satisfy the credential key grammar;
 * branding has no runtime representation.
 */
const remoteHostId = z.string().refine(
  isCredentialKeySegment,
  'a remote host id must be a credential-key segment: lowercase letters, digits, and hyphens, starting with a letter',
).transform(value => brandString<RemoteHostId>(value))

/**
 * One configured remote host. The SSH password is deliberately absent: it
 * lives in `ctx.credentials` under a per-host credential record (see the
 * registry).
 */
export interface RemoteHostRecord {
  /** Stable unique id; doubles as the credential-key segment of the host's password record. */
  readonly id: RemoteHostId
  /** Operator-facing display name. */
  readonly label: string
  /** SSH host name or address; IPv6 literals keep their colons. */
  readonly host: string
  /** SSH port. */
  readonly port: number
  /** Remote login user. */
  readonly user: string
  /** The remote Harness Web port the tunnel forwards to. */
  readonly remotePort: number
  /** The local loopback port the tunnel binds. */
  readonly localPort: number
}

const port = z.number().int().min(1).max(65_535)

/**
 * One durable record. `strict()` is the reason a stray `password` field fails
 * the load: the secret belongs in `ctx.credentials`, and a record that carries
 * one is a mistake worth stopping for.
 */
export const remoteHostRecordSchema = z.object({
  id: remoteHostId,
  label: z.string().min(1),
  host: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9.:-]*$/),
  port,
  user: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/),
  remotePort: port,
  localPort: port,
}).strict()

/**
 * Durable registry state: the ordered host list. Array order is display
 * order; the records themselves live in the `hosts` table.
 */
export const remoteHostDomainState = z.object({
  hostIds: z.array(z.string()).default([]),
})

/** Durable registry state inferred from {@link remoteHostDomainState}. */
export type RemoteHostDomainState = z.infer<typeof remoteHostDomainState>

/**
 * The domain the registry's Cordis service opens over `ctx.storageDomain`.
 * `global` needs both its schema and the value served before the first write.
 */
export const remoteHostDomainSpec = defineDomain({
  name: 'remote_hosts',
  version: 1,
  tables: {
    hosts: domainTable<RemoteHostId, RemoteHostRecord>(remoteHostRecordSchema),
  },
  global: { schema: remoteHostDomainState, initial: { hostIds: [] } },
})

/**
 * Validate one candidate record.
 * @param value - the candidate, as stored or as a caller supplied it.
 * @returns the parsed record, with its id branded.
 */
export function parseRemoteHostRecord(value: unknown): RemoteHostRecord {
  return remoteHostRecordSchema.parse(value)
}
