// @vitest-environment jsdom
/**
 * The browser plugin: what it injects, where it registers, that the panel
 * reads the Host only once rendered through the injected face, and that the
 * whole contribution leaves with its fiber.
 */

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { TestRemote, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import type { RemoteHostRow } from '@deepseek-ai/dsh-api-remotes/client'
import { apply, inject, NS, PANEL_ID } from '../src/client/index.ts'
import type { RemoteHostsFace } from '../src/client/controller.ts'
import { RemoteHostsIcon } from '../src/client/RemoteHostsIcon.tsx'
import { RemoteHostsPanel } from '../src/client/RemoteHostsPanel.tsx'
import { zh } from '../src/client/locales.ts'
import { apply as hostApply } from '../src/index.ts'

usePinnedBrowserLanguages('zh-CN')
afterEach(cleanup)

const BOX: RemoteHostRow = {
  id: 'box', label: 'Build box', host: 'box.example', port: 22, user: 'jin', remotePort: 3080, localPort: 51080, connected: false,
}

const CONNECTION = {
  id: 'box', localPort: 51080, origin: 'http://127.0.0.1:51080',
  frameUrl: 'http://127.0.0.1:51080/?token=tok',
}

function answer<T>(value: T) {
  return { ok: true as const, value }
}

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  const list = vi.fn(() => Promise.resolve(answer([BOX])))
  const connect = vi.fn(() => Promise.resolve(answer(CONNECTION)))
  const remote = new TestRemote(ctx, {
    remoteHosts: {
      list,
      connect,
      disconnect: vi.fn(() => Promise.resolve(answer(undefined))),
      remove: vi.fn(() => Promise.resolve(answer(undefined))),
      add: vi.fn(() => Promise.resolve(answer(BOX))),
    },
  })
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale, remote, list, connect }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: {
      'main': { kind: 'keyed', scope: 'root' },
      'sidebar.panellist': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
}

describe('ui-remote-hosts browser plugin', () => {
  it('keeps the host Loader entry inert', () => {
    expect(() => { hostApply() }).not.toThrow()
  })

  it('declares only the services the panel and its Remote namespace use', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.remoteHosts'])
  })

  it('registers the sidebar entry and its panel, reads the Host once rendered, and leaves with the fiber', async () => {
    const b = await bench()
    declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    const entry = b.slots.entries('main')[0]!
    expect(entry.component).toBe(RemoteHostsPanel)
    expect(entry.options).toMatchObject({ key: PANEL_ID })
    expect(entry.locale).toBe(NS)
    // The sidebar entry addresses the page by the same id and speaks the dictionary.
    const icon = b.slots.entries('sidebar.panellist')[0]!
    expect(icon.component).toBe(RemoteHostsIcon)
    expect(icon.options).toMatchObject({ id: PANEL_ID, order: 1 })
    expect(icon.locale).toBe(NS)
    expect(resolveSlotLabel(icon.options.label)).toBe(zh.panel)

    // A panel never rendered holds no snapshot to read.
    expect(b.list).not.toHaveBeenCalled()
    const face = (entry.inject as unknown as () => RemoteHostsFace)()
    expect(face.hooks.remoteHosts.getSnapshot().status).toBe('idle')
    face.ensure()
    await vi.waitFor(() => { expect(face.hooks.remoteHosts.getSnapshot().status).toBe('ready') })
    expect(b.list).toHaveBeenCalledTimes(1)
    face.ensure()
    expect(b.list).toHaveBeenCalledTimes(1)

    // The framed host is the tunnel origin connect() returned.
    face.connect('box')
    await vi.waitFor(() => { expect(face.hooks.remoteHosts.getSnapshot().frameOrigin).toBe('http://127.0.0.1:51080/?token=tok') })

    // The icon reads no application state and renders at the sidebar's size.
    // Each seat types its own hook, so one rejecting implementation is cast once.
    const unread = ((): never => { throw new Error('The sidebar icon must not read application state') }) as never
    const glyph = render(<RemoteHostsIcon size={18} active={false}
      usePanelInfo={unread} useSessions={unread} useSessionStatus={unread} useSessionRetainInfo={unread}
      useWorkspaces={unread} useResource={unread} />)
    expect(glyph.container.querySelector('svg')?.getAttribute('width')).toBe('18')

    await fiber.dispose()
    expect(b.slots.entries('main')).toHaveLength(0)
    expect(b.slots.entries('sidebar.panellist')).toHaveLength(0)
    // The controller left with the fiber: a late action publishes nothing.
    face.connect('box')
    expect(b.connect).toHaveBeenCalledTimes(1)
  })
})
