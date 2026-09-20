/**
 * The remote-host panel: the configured hosts with their tunnel actions, the
 * add form, and — while a host is connected — the frame that operates that
 * host's own GUI. The frame loads the tunnel origin `connect()` returned, so
 * its document shares the remote's origin and its fetch and WebSocket traffic
 * passes the remote's fence as same-origin.
 */

import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteHostRow } from '@deepseek-ai/dsh-api-remotes/client'
import type { RemoteHostsFace, RemoteHostsState } from './controller.ts'
import type { RemoteHostsLocaleKey } from './locales.ts'
import { draftOf, EMPTY_FORM, failureText, type RemoteHostFormValues, type Translate } from './presentation.ts'
import css from './RemoteHostsPanel.module.css'

/** Full component props assembled by the main slot renderer. */
export type RemoteHostsPanelProps =
  PropsRuntime<'main'>
  & PropsLocale<'remoteHosts'>
  & InjectFace<RemoteHostsFace>

/** A form field: its locale label, its input type, and its slot in the values. */
type FieldKey = keyof RemoteHostFormValues & RemoteHostsLocaleKey

/** The text inputs of the add form, in display order. */
const FIELDS: readonly { readonly key: FieldKey; readonly type: 'text' | 'password' }[] = [
  { key: 'label', type: 'text' },
  { key: 'host', type: 'text' },
  { key: 'port', type: 'text' },
  { key: 'user', type: 'text' },
  { key: 'password', type: 'password' },
  { key: 'remotePort', type: 'text' },
  { key: 'localPort', type: 'text' },
  { key: 'webToken', type: 'text' },
]

/** The SSH target a row names, as an operator reads it. */
function targetOf(row: RemoteHostRow): string {
  return `${row.user}@${row.host}:${String(row.port)}`
}

/**
 * One host row: its label and SSH target, then its tunnel and remove actions.
 * Removing a host forgets its stored password, so the row asks once.
 */
function HostRow({ row, state, t, onConnect, onDisconnect, onRemove }: {
  readonly row: RemoteHostRow
  readonly state: RemoteHostsState
  readonly t: Translate
  readonly onConnect: (id: string) => void
  readonly onDisconnect: (id: string) => void
  readonly onRemove: (id: string) => void
}): ReactNode {
  const [confirming, setConfirming] = useState(false)
  const busy = state.busy.includes(row.id)
  return (
    <li className={css.host} data-remote-host={row.id} {...row.connected ? { 'data-connected': '' } : {}}>
      <div className={css.hostText}>
        <span className={css.hostLabel}>{row.label}</span>
        <span className={css.hostTarget}>{targetOf(row)}</span>
      </div>
      <div className={css.actions}>
        {row.connected
          ? (
            <button type="button" className={css.button} disabled={busy} onClick={() => { setConfirming(false); onDisconnect(row.id) }}>
              {t('disconnect')}
            </button>
          )
          : (
            <button type="button" className={css.button} disabled={busy} onClick={() => { onConnect(row.id) }}>
              {busy ? t('connecting') : t('connect')}
            </button>
          )}
        {confirming
          ? (
            <>
              <button type="button" className={css.danger} disabled={busy} onClick={() => { setConfirming(false); onRemove(row.id) }}>
                {t('confirmRemove')}
              </button>
              <button type="button" className={css.button} onClick={() => { setConfirming(false) }}>
                {t('cancel')}
              </button>
            </>
          )
          : (
            <button type="button" className={css.button} onClick={() => { setConfirming(true) }}>
              {t('remove')}
            </button>
          )}
      </div>
    </li>
  )
}

/**
 * Render the switcher: the frame bar and the framed remote GUI while a host
 * is connected, otherwise the host list with its add form.
 * @param props - the derived runtime share, the locale seat, and the inject face.
 * @returns the panel element.
 */
export function RemoteHostsPanel(props: RemoteHostsPanelProps): ReactNode {
  const { t } = props
  const state = props.useRemoteHosts(snapshot => snapshot)
  const active = state.active
  const frameUrl = state.frameOrigin
  const [form, setForm] = useState<RemoteHostFormValues>(EMPTY_FORM)
  const [adding, setAdding] = useState(false)

  useEffect(() => { props.ensure() }, [props.ensure])

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    const draft = draftOf(form)
    /* v8 ignore next -- the submit control is disabled exactly while the draft is incomplete */
    if (draft !== null) props.add(draft)
  }

  if (active !== null && frameUrl !== null) {
    const row = state.rows.find(candidate => candidate.id === active)
    return (
      <div className={css.panel} data-remote-hosts-panel="framed">
        <div className={css.frameBar}>
          <span className={css.hostLabel}>{row?.label ?? active}</span>
          <span className={css.hostTarget}>{row === undefined ? active : targetOf(row)}</span>
          <button
            type="button"
            className={css.button}
            disabled={state.busy.includes(active)}
            onClick={() => { props.disconnect(active) }}
          >
            {t('disconnect')}
          </button>
        </div>
        {state.failure === null ? null : <p className={css.error} role="alert">{failureText(state.failure, t)}</p>}
        {/* The URL carries the remote's launch token when one is stored: the
            exchange on the tunnel authority mints the cookie the frame needs. */}
        <iframe className={css.frame} title={t('frameTitle')} src={frameUrl} />
      </div>
    )
  }

  const draft = draftOf(form)
  return (
    <div className={css.panel} data-remote-hosts-panel="list" aria-busy={state.status === 'loading'}>
      <header className={css.head}>
        <h2 className={css.title}>{t('title')}</h2>
        <button type="button" className={css.button} aria-expanded={adding} onClick={() => { setAdding(!adding) }}>
          {adding ? t('cancel') : t('addHost')}
        </button>
      </header>
      <p className={css.intro}>{t('intro')}</p>

      {state.status === 'loading' ? <p className={css.note}>{t('loading')}</p> : null}
      {state.status === 'error'
        ? (
          <div className={css.failure}>
            <p className={css.error} role="alert">{t('listError')}</p>
            <button type="button" className={css.button} onClick={props.refresh}>{t('retry')}</button>
          </div>
        )
        : null}

      {adding
        ? (
          <form className={css.form} onSubmit={submit}>
            {FIELDS.map(({ key, type }) => (
              <label className={css.field} key={key}>
                <span className={css.fieldLabel}>{t(key)}</span>
                <input
                  className={css.input}
                  type={type}
                  value={form[key]}
                  onChange={(event) => { setForm({ ...form, [key]: event.target.value }) }}
                />
              </label>
            ))}
            <button type="submit" className={css.primary} disabled={draft === null || state.busy.includes('add')}>
              {t('save')}
            </button>
          </form>
        )
        : null}

      {state.status === 'ready' && state.rows.length === 0 ? <p className={css.note}>{t('empty')}</p> : null}
      <ul className={css.hosts}>
        {state.rows.map(row => (
          <HostRow
            key={row.id}
            row={row}
            state={state}
            t={t}
            onConnect={props.connect}
            onDisconnect={props.disconnect}
            onRemove={props.remove}
          />
        ))}
      </ul>

      {state.failure === null ? null : <p className={css.error} role="alert">{failureText(state.failure, t)}</p>}
    </div>
  )
}
