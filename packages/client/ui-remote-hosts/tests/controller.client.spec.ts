/**
 * The switcher's controller: what it reads, how its writes settle, which
 * refusals the store words, and what a disposal drops.
 */

import { describe, expect, it, vi } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import type { RemoteHostAddInput, RemoteHostRow } from '@deepseek-ai/dsh-api-remotes/client'
import { RemoteHostsController, type RemoteHostDraft } from '../src/client/controller.ts'

const BOX: RemoteHostRow = {
  id: 'box', label: 'Build box', host: 'box.example', port: 22, user: 'jin', remotePort: 3080, localPort: 51080, connected: false,
}

const CONNECTION = { id: 'box', localPort: 51080, origin: 'http://127.0.0.1:51080' }

const DRAFT: RemoteHostDraft = {
  label: 'Build box', host: 'box.example', port: 22, user: 'jin', remotePort: 3080, localPort: 51080, password: 'secret',
}

function ok<T>(value: T) {
  return { ok: true as const, value }
}

function refused(code: string) {
  // The double's code map is keyed by literal codes; a spec-chosen string stands in.
  return { ok: false as const, error: new RemoteError(code as never, 'refused', {} as never) }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}

/** A Remote answer as the generated client returns it. */
type Answer<T> = ReturnType<typeof ok<T>>

function bench(overrides: {
  list?: ReturnType<typeof vi.fn>
  connect?: ReturnType<typeof vi.fn>
  disconnect?: ReturnType<typeof vi.fn>
  remove?: ReturnType<typeof vi.fn>
  add?: ReturnType<typeof vi.fn>
} = {}) {
  const remoteHosts = {
    list: overrides.list ?? vi.fn(() => Promise.resolve(ok([BOX]))),
    connect: overrides.connect ?? vi.fn(() => Promise.resolve(ok(CONNECTION))),
    disconnect: overrides.disconnect ?? vi.fn(() => Promise.resolve(ok(undefined))),
    remove: overrides.remove ?? vi.fn(() => Promise.resolve(ok(undefined))),
    add: overrides.add ?? vi.fn(() => Promise.resolve(ok(BOX))),
  }
  const controller = new RemoteHostsController({ remote: { remoteHosts } } as never)
  const face = controller.inject()
  return { remoteHosts, controller, face, state: () => controller.getSnapshot() }
}

describe('RemoteHostsController', () => {
  it('reads the Host once from idle, and only refresh re-reads', async () => {
    const b = bench()
    b.face.ensure()
    await vi.waitFor(() => { expect(b.state().status).toBe('ready') })
    expect(b.state().rows).toEqual([BOX])
    b.face.ensure()
    expect(b.remoteHosts.list).toHaveBeenCalledTimes(1)
    b.face.refresh()
    await vi.waitFor(() => { expect(b.remoteHosts.list).toHaveBeenCalledTimes(2) })
  })

  it('keeps the last rows while a read is refused, and a retry recovers', async () => {
    const list = vi.fn()
      .mockResolvedValueOnce(ok([BOX]))
      .mockResolvedValueOnce(refused('gateway/internal'))
      .mockResolvedValueOnce(ok([{ ...BOX, id: 'other' }]))
    const b = bench({ list })
    b.face.ensure()
    await vi.waitFor(() => { expect(b.state().status).toBe('ready') })
    b.face.refresh()
    await vi.waitFor(() => { expect(b.state().status).toBe('error') })
    expect(b.state().rows).toEqual([BOX])
    b.face.refresh()
    await vi.waitFor(() => { expect(b.state().status).toBe('ready') })
    expect(b.state().rows.map(row => row.id)).toEqual(['other'])
  })

  it('connects, points the frame at the tunnel origin, and re-reads the rows', async () => {
    const b = bench()
    b.face.ensure()
    await vi.waitFor(() => { expect(b.state().status).toBe('ready') })
    b.face.connect('box')
    await vi.waitFor(() => { expect(b.state().frameOrigin).toBe('http://127.0.0.1:51080') })
    expect(b.state().active).toBe('box')
    expect(b.state().busy).toEqual([])
    expect(b.remoteHosts.list).toHaveBeenCalledTimes(2)
  })

  it('words a refused connect in the store and leaves the frame closed', async () => {
    const b = bench({ connect: vi.fn(() => Promise.resolve(refused('remote-host/port-taken'))) })
    b.face.ensure()
    await vi.waitFor(() => { expect(b.state().status).toBe('ready') })
    b.face.connect('box')
    await vi.waitFor(() => { expect(b.state().failure).toEqual({ action: 'connect', code: 'remote-host/port-taken' }) })
    expect(b.state().frameOrigin).toBeNull()
    expect(b.state().busy).toEqual([])
    // Every settled call rereads the list, so a refusal that changed nothing
    // still leaves the panel showing the Host's own answer.
    await vi.waitFor(() => { expect(b.remoteHosts.list).toHaveBeenCalledTimes(2) })
  })

  it('closes the frame of the host it disconnected, and keeps another host framed', async () => {
    const b = bench()
    b.face.ensure()
    await vi.waitFor(() => { expect(b.state().status).toBe('ready') })
    b.face.connect('box')
    await vi.waitFor(() => { expect(b.state().frameOrigin).not.toBeNull() })
    b.face.disconnect('other')
    await vi.waitFor(() => { expect(b.remoteHosts.disconnect).toHaveBeenCalledWith('other') })
    expect(b.state().active).toBe('box')
    b.face.disconnect('box')
    await vi.waitFor(() => { expect(b.state().frameOrigin).toBeNull() })
    expect(b.state().active).toBeNull()
  })

  it('forgets a removed host and closes its frame; another host stays framed', async () => {
    const b = bench()
    b.face.ensure()
    await vi.waitFor(() => { expect(b.state().status).toBe('ready') })
    b.face.connect('box')
    await vi.waitFor(() => { expect(b.state().frameOrigin).not.toBeNull() })
    b.face.remove('other')
    await vi.waitFor(() => { expect(b.remoteHosts.remove).toHaveBeenCalledWith('other') })
    expect(b.state().active).toBe('box')
    b.face.remove('box')
    await vi.waitFor(() => { expect(b.state().frameOrigin).toBeNull() })
  })

  it('stores a new host under a minted credential-safe id and re-reads', async () => {
    const b = bench()
    b.face.ensure()
    await vi.waitFor(() => { expect(b.state().status).toBe('ready') })
    b.face.add(DRAFT)
    await vi.waitFor(() => { expect(b.remoteHosts.add).toHaveBeenCalledTimes(1) })
    const input = b.remoteHosts.add.mock.calls[0]![0] as RemoteHostAddInput
    expect(input.id).toMatch(/^host-[0-9a-f-]+$/u)
    expect(input).toMatchObject({ label: 'Build box', host: 'box.example', user: 'jin', password: 'secret' })
    expect(b.state().failure).toBeNull()
    await vi.waitFor(() => { expect(b.remoteHosts.list).toHaveBeenCalledTimes(2) })
  })

  it('words a refused add, remove, and disconnect by what was being done', async () => {
    const b = bench({
      add: vi.fn(() => Promise.resolve(refused('gateway/internal'))),
      remove: vi.fn(() => Promise.resolve(refused('gateway/internal'))),
      disconnect: vi.fn(() => Promise.resolve(refused('gateway/internal'))),
    })
    b.face.ensure()
    await vi.waitFor(() => { expect(b.state().status).toBe('ready') })
    b.face.add(DRAFT)
    await vi.waitFor(() => { expect(b.state().failure).toEqual({ action: 'add', code: 'gateway/internal' }) })
    b.face.remove('box')
    await vi.waitFor(() => { expect(b.state().failure).toEqual({ action: 'remove', code: 'gateway/internal' }) })
    b.face.disconnect('box')
    await vi.waitFor(() => { expect(b.state().failure).toEqual({ action: 'disconnect', code: 'gateway/internal' }) })
  })

  it('drops a second action for the same host while the first is on the wire', async () => {
    const pending = deferred<Answer<typeof CONNECTION>>()
    const connect = vi.fn(() => pending.promise)
    const b = bench({ connect })
    b.face.ensure()
    await vi.waitFor(() => { expect(b.state().status).toBe('ready') })
    b.face.connect('box')
    b.face.connect('box')
    expect(connect).toHaveBeenCalledTimes(1)
    pending.resolve(ok(CONNECTION))
    await vi.waitFor(() => { expect(b.state().frameOrigin).toBe('http://127.0.0.1:51080') })
    expect(b.state().busy).toEqual([])
  })

  it('drops the settlement of a connect another connect superseded', async () => {
    const first = deferred<Answer<typeof CONNECTION>>()
    const connect = vi.fn((id: string) => id === 'box'
      ? first.promise
      : Promise.resolve(ok({ id, localPort: 51081, origin: 'http://127.0.0.1:51081' })))
    const b = bench({
      connect,
      list: vi.fn(() => Promise.resolve(ok([BOX, { ...BOX, id: 'rack', label: 'Rack' }]))),
    })
    b.face.ensure()
    await vi.waitFor(() => { expect(b.state().status).toBe('ready') })
    b.face.connect('box')
    b.face.connect('rack')
    await vi.waitFor(() => { expect(b.state().active).toBe('rack') })
    first.resolve(ok(CONNECTION))
    await vi.waitFor(() => { expect(b.state().busy).toEqual([]) })
    expect(b.state().active).toBe('rack')
    expect(b.state().frameOrigin).toBe('http://127.0.0.1:51081')
  })

  it('publishes nothing for a write disposed while it was on the wire', async () => {
    const pending = deferred<Answer<typeof CONNECTION>>()
    const b = bench({ connect: vi.fn(() => pending.promise) })
    b.face.ensure()
    await vi.waitFor(() => { expect(b.state().status).toBe('ready') })
    b.face.connect('box')
    expect(b.state().busy).toEqual(['box'])
    b.controller.dispose()
    pending.resolve(ok(CONNECTION))
    await Promise.resolve()
    expect(b.state()).toEqual({
      status: 'ready', rows: [BOX], busy: ['box'], active: null, frameOrigin: null, failure: null,
    })
  })

  it('lands only the newest read when two overlap', async () => {
    const pending = deferred<Answer<RemoteHostRow[]>>()
    let call = 0
    const list = vi.fn(() => {
      call += 1
      return call === 1 ? pending.promise : Promise.resolve(ok([{ ...BOX, id: 'newest' }]))
    })
    const b = bench({ list })
    const first = b.controller.load()
    const second = b.controller.load()
    pending.resolve(ok([BOX]))
    await Promise.all([first, second])
    await vi.waitFor(() => { expect(b.state().rows.map(row => row.id)).toEqual(['newest']) })
  })

  it('drops every settlement after disposal and refuses new actions', async () => {
    const pending = deferred<Answer<RemoteHostRow[]>>()
    const list = vi.fn(() => pending.promise)
    const b = bench({ list })
    void b.controller.load()
    b.controller.dispose()
    pending.resolve(ok([BOX]))
    await Promise.resolve()
    expect(b.state().status).toBe('loading')
    b.face.connect('box')
    expect(b.remoteHosts.connect).not.toHaveBeenCalled()
    b.face.refresh()
    expect(b.remoteHosts.list).toHaveBeenCalledTimes(1)
    b.face.ensure()
    expect(b.remoteHosts.list).toHaveBeenCalledTimes(1)
  })
})
