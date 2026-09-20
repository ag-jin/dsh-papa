/** Display sentences and form parsing for the remote-host switcher. */

import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteHostsLocaleKey } from './locales.ts'
import type { RemoteHostDraft, RemoteHostsAction, RemoteHostsFailure } from './controller.ts'

/** The translate seat of the switcher's dictionary. */
export type Translate = PropsLocale<'remoteHosts'>['t']

/** The sentence each non-connect refusal reads as, by what was being done. */
const ACTION_FAILED_KEYS = {
  add: 'addFailed',
  remove: 'removeFailed',
  disconnect: 'disconnectFailed',
} satisfies Record<Exclude<RemoteHostsAction, 'connect'>, RemoteHostsLocaleKey>

/** The sentence a refused connect reads as, by the Host's code. */
const CONNECT_CODE_KEYS = {
  'remote-host/unknown': 'unknownHost',
  'remote-host/no-password': 'noPassword',
  'remote-host/port-taken': 'portTaken',
} satisfies Record<string, RemoteHostsLocaleKey>

/**
 * Resolve one Host failure code to its sentence key. A code this client does
 * not know — a carrier code included — reads as the generic SSH failure, so an
 * older client renders a newer Host's refusal instead of nothing.
 * @param code - the Host's failure code.
 * @returns the sentence key, or undefined when the code is unlisted.
 */
function connectCodeKey(code: string): RemoteHostsLocaleKey | undefined {
  return Object.hasOwn(CONNECT_CODE_KEYS, code)
    ? CONNECT_CODE_KEYS[code as keyof typeof CONNECT_CODE_KEYS]
    : undefined
}

/**
 * What the last refused action reads as: a connect by its Host code — every
 * unlisted code, carrier included, reads as the SSH failure — and every other
 * action by what was being done.
 * @param failure - the refused action and its code, when the Host refused.
 * @param t - the switcher's translate seat.
 * @returns the sentence.
 */
export function failureText(failure: RemoteHostsFailure, t: Translate): string {
  if (failure.action !== 'connect') return t(ACTION_FAILED_KEYS[failure.action])
  const key = failure.code === undefined ? undefined : connectCodeKey(failure.code)
  return key === undefined ? t('unreachable') : t(key)
}

/** The add form's field values as typed, before parsing. */
export interface RemoteHostFormValues {
  readonly label: string
  readonly host: string
  readonly user: string
  readonly password: string
  /** The remote Harness's Web launch token; blank leaves the frame unauthenticated. */
  readonly webToken: string
  readonly port: string
  readonly remotePort: string
  readonly localPort: string
}

/** The form opens blank, with the ports the plan's fixed layout suggests. */
export const EMPTY_FORM: RemoteHostFormValues = {
  label: '', host: '', user: '', password: '', webToken: '', port: '22', remotePort: '3080', localPort: '51080',
}

/**
 * Read one port field. Decimal digits only, within the TCP port range, so an
 * incomplete or pasted value reads as absent rather than as a wrong port.
 * @param text - the field's raw value.
 * @returns the port, or null while the field holds no usable port.
 */
export function parsePort(text: string): number | null {
  if (!/^\d{1,5}$/u.test(text)) return null
  const port = Number.parseInt(text, 10)
  return port >= 1 && port <= 65_535 ? port : null
}

/**
 * The record the form's values hold, or null while any field is missing. The
 * submit control is disabled exactly when this returns null, so a draft is
 * complete whenever the operator can submit it.
 * @param values - the form's field values.
 * @returns the draft, or null.
 */
export function draftOf(values: RemoteHostFormValues): RemoteHostDraft | null {
  const port = parsePort(values.port)
  const remotePort = parsePort(values.remotePort)
  const localPort = parsePort(values.localPort)
  const label = values.label.trim()
  const host = values.host.trim()
  const user = values.user.trim()
  if (label === '' || host === '' || user === '' || values.password === '') return null
  if (port === null || remotePort === null || localPort === null) return null
  // The token rides a URL, so a pasted one keeps no surrounding whitespace; the
  // password stays byte-exact because it authenticates instead of parsing.
  return {
    label,
    host,
    user,
    port,
    remotePort,
    localPort,
    password: values.password,
    webToken: values.webToken.trim(),
  }
}
