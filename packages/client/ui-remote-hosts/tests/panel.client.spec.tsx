// @vitest-environment jsdom
/**
 * The panel: the states it words, the actions its rows and form drive, the
 * refusal sentences, and the frame that shows the connected remote.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { RemoteHostRow } from '@deepseek-ai/dsh-api-remotes/client'
import type { RemoteHostsState } from '../src/client/controller.ts'
import { en, zh, type RemoteHostsLocaleKey } from '../src/client/locales.ts'
import { RemoteHostsPanel } from '../src/client/RemoteHostsPanel.tsx'
import type { RemoteHostsPanelProps } from '../src/client/RemoteHostsPanel.tsx'

afterEach(cleanup)

const BOX: RemoteHostRow = {
  id: 'box', label: 'Build box', host: 'box.example', port: 22, user: 'jin', remotePort: 3080, localPort: 51080, connected: false,
}

const READY: RemoteHostsState = {
  status: 'ready', rows: [], busy: [], active: null, frameOrigin: null, failure: null,
}

const translate = (dict: typeof en): RemoteHostsPanelProps['t'] => ((key: RemoteHostsLocaleKey, params?: Record<string, string>): string =>
  Object.entries(params ?? {}).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, value),
    dict[key],
  )) as RemoteHostsPanelProps['t']

function renderPanel(state: Partial<RemoteHostsState> = {}, dict: typeof en = en) {
  const store = createSnapshotStore<RemoteHostsState>({ ...READY, ...state })
  const actions = {
    ensure: vi.fn(), refresh: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), remove: vi.fn(), add: vi.fn(),
  }
  const props = {
    t: translate(dict),
    ...actions,
    useRemoteHosts: bindSnapshotSelector(store),
  } as unknown as RemoteHostsPanelProps
  const { rerender } = render(<RemoteHostsPanel {...props} />)
  return {
    actions,
    set: (next: Partial<RemoteHostsState>) => { act(() => { store.set({ ...store.getSnapshot(), ...next }) }) },
    setLanguage: (next: typeof en) => { rerender(<RemoteHostsPanel {...props} t={translate(next)} />) },
  }
}

function field(label: string): HTMLInputElement {
  return screen.getByLabelText(label) as HTMLInputElement
}

describe('RemoteHostsPanel', () => {
  it('asks the store once mounted and words the loading, error, and empty states', () => {
    const { actions, set } = renderPanel({ status: 'loading' })
    expect(actions.ensure).toHaveBeenCalledTimes(1)
    expect(screen.getByText(en.loading)).toBeTruthy()
    set({ status: 'error' })
    expect(screen.getByRole('alert').textContent).toBe(en.listError)
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    expect(actions.refresh).toHaveBeenCalledTimes(1)
    set({ status: 'ready' })
    expect(screen.getByText(en.empty)).toBeTruthy()
    expect(document.querySelector('[aria-busy="true"]')).toBeNull()
  })

  it('marks the list busy while it loads', () => {
    renderPanel({ status: 'loading' })
    expect(document.querySelector('[data-remote-hosts-panel="list"]')?.getAttribute('aria-busy')).toBe('true')
  })

  it('lists each host with its target and drives its tunnel actions', () => {
    const { actions } = renderPanel({
      rows: [BOX, { ...BOX, id: 'live', label: 'Live box', connected: true }],
    })
    const rows = screen.getAllByRole('listitem')
    expect(rows.map(row => row.getAttribute('data-remote-host'))).toEqual(['box', 'live'])
    expect(rows[1]?.hasAttribute('data-connected')).toBe(true)
    expect(screen.getAllByText('jin@box.example:22')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: en.disconnect }))
    expect(actions.disconnect).toHaveBeenCalledTimes(1)
    expect(actions.disconnect).toHaveBeenCalledWith('live')
    fireEvent.click(screen.getByRole('button', { name: en.connect }))
    expect(actions.connect).toHaveBeenCalledTimes(1)
    expect(actions.connect).toHaveBeenCalledWith('box')
  })

  it('disables a row with a write on the wire and says it is connecting', () => {
    renderPanel({ rows: [BOX], busy: ['box'] })
    expect(screen.getByRole('button', { name: en.connecting })).toHaveProperty('disabled', true)
  })

  it('asks once before removing a host, and cancel keeps it', () => {
    const { actions } = renderPanel({ rows: [BOX] })
    expect(screen.queryByRole('button', { name: en.confirmRemove })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.remove }))
    expect(screen.getByRole('button', { name: en.confirmRemove })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.cancel }))
    expect(screen.queryByRole('button', { name: en.confirmRemove })).toBeNull()
    expect(actions.remove).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: en.remove }))
    fireEvent.click(screen.getByRole('button', { name: en.confirmRemove }))
    expect(actions.remove).toHaveBeenCalledTimes(1)
    expect(actions.remove).toHaveBeenCalledWith('box')
  })

  it('saves a complete draft and stays inert while the form is incomplete', () => {
    const { actions } = renderPanel()
    fireEvent.click(screen.getByRole('button', { name: en.addHost }))
    expect(screen.getByRole('button', { name: en.save })).toHaveProperty('disabled', true)
    fireEvent.change(field(en.label), { target: { value: 'Build box' } })
    fireEvent.change(field(en.host), { target: { value: 'box.example' } })
    fireEvent.change(field(en.user), { target: { value: 'jin' } })
    fireEvent.change(field(en.password), { target: { value: 'secret' } })
    // The ports open at the fixed layout's suggestion; an unusable one blocks the save.
    fireEvent.change(field(en.localPort), { target: { value: '70000' } })
    expect(screen.getByRole('button', { name: en.save })).toHaveProperty('disabled', true)
    fireEvent.change(field(en.localPort), { target: { value: '51080' } })
    const save = screen.getByRole('button', { name: en.save })
    expect(save).toHaveProperty('disabled', false)
    fireEvent.click(save)
    expect(actions.add).toHaveBeenCalledTimes(1)
    expect(actions.add).toHaveBeenCalledWith({
      label: 'Build box', host: 'box.example', port: 22, user: 'jin', remotePort: 3080, localPort: 51080, password: 'secret',
    })
  })

  it('closes the add form without saving', () => {
    const { actions } = renderPanel()
    fireEvent.click(screen.getByRole('button', { name: en.addHost }))
    expect(field(en.label)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.cancel }))
    expect(screen.queryByLabelText(en.label)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.addHost }))
    expect(screen.getByRole('button', { name: en.save })).toHaveProperty('disabled', true)
    expect(actions.add).not.toHaveBeenCalled()
  })

  it('words every refusal in the dictionary and dismisses it on the next action', () => {
    const { set } = renderPanel({ rows: [BOX], failure: { action: 'connect', code: 'remote-host/port-taken' } })
    const alert = (): string => screen.getByRole('alert').textContent ?? ''
    expect(alert()).toBe(en.portTaken)
    set({ failure: { action: 'connect', code: 'remote-host/unknown' } })
    expect(alert()).toBe(en.unknownHost)
    set({ failure: { action: 'connect', code: 'remote-host/no-password' } })
    expect(alert()).toBe(en.noPassword)
    set({ failure: { action: 'connect', code: 'remote-host/unreachable' } })
    expect(alert()).toBe(en.unreachable)
    set({ failure: { action: 'add', code: 'gateway/internal' } })
    expect(alert()).toBe(en.addFailed)
    set({ failure: { action: 'remove', code: 'gateway/internal' } })
    expect(alert()).toBe(en.removeFailed)
    set({ failure: { action: 'disconnect', code: 'gateway/internal' } })
    expect(alert()).toBe(en.disconnectFailed)
    set({ failure: null })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('frames the connected host through its tunnel origin and disconnects from the bar', () => {
    const { actions, set } = renderPanel({
      rows: [{ ...BOX, connected: true }],
      active: 'box',
      frameOrigin: 'http://127.0.0.1:51080',
    })
    expect(document.querySelector('[data-remote-hosts-panel="framed"]')).toBeTruthy()
    expect(screen.queryByRole('listitem')).toBeNull()
    const frame = document.querySelector('iframe')
    expect(frame?.getAttribute('src')).toBe('http://127.0.0.1:51080/')
    expect(frame?.getAttribute('title')).toBe(en.frameTitle)
    expect(screen.getByText('Build box')).toBeTruthy()
    expect(screen.getByText('jin@box.example:22')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.disconnect }))
    expect(actions.disconnect).toHaveBeenCalledTimes(1)
    expect(actions.disconnect).toHaveBeenCalledWith('box')
    // A refusal words itself over the framed view too.
    set({ failure: { action: 'connect', code: 'remote-host/port-taken' } })
    expect(screen.getByRole('alert').textContent).toBe(en.portTaken)
    // A host no longer listed still names itself by id until the frame closes.
    set({ active: 'ghost', failure: null })
    expect(screen.getAllByText('ghost')).toHaveLength(2)
  })

  it('speaks the active language', () => {
    const { setLanguage } = renderPanel({ rows: [BOX] }, zh)
    expect(screen.getByRole('heading', { name: zh.title })).toBeTruthy()
    expect(screen.getByRole('button', { name: zh.connect })).toBeTruthy()
    setLanguage(en)
    expect(screen.getByRole('heading', { name: en.title })).toBeTruthy()
    expect(screen.getByRole('button', { name: en.connect })).toBeTruthy()
  })
})
