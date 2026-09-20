/**
 * Remote-host switcher, browser half: the sidebar entry beside the Plugins
 * entry, and the panel that frames the connected remote's own GUI through the
 * tunnel origin its `connect()` returns.
 * @module @deepseek-ai/dsh-client-ui-remote-hosts/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the root `main` keyed slot the panel registers into, declared by
// ui-layout with the panel id brand, and the `sidebar.panellist` list the
// entry registers into, declared by ui-sidebar.
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the ctx.remote Context merge and the `remoteHosts` namespace face.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { RemoteHostsController } from './controller.ts'
import { en, zh, type RemoteHostsLocaleKey } from './locales.ts'
import { RemoteHostsIcon } from './RemoteHostsIcon.tsx'
import { RemoteHostsPanel } from './RemoteHostsPanel.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Remote-host switcher copy. */
    'remoteHosts': RemoteHostsLocaleKey
  }
}

export type { RemoteHostsPanelProps } from './RemoteHostsPanel.tsx'
export type {
  RemoteHostDraft, RemoteHostsAction, RemoteHostsFace, RemoteHostsFailure, RemoteHostsState,
} from './controller.ts'
export type { RemoteHostsLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Remote-host switcher copy. */
    'remoteHosts': RemoteHostsLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'remoteHosts'

/** The id shared by the sidebar entry and the main panel it opens. */
export const PANEL_ID = 'remote-hosts' as MainPanelId

/** Services required by the sidebar registration and the Remote namespace. */
export const inject = ['slots', 'locale', 'remote', 'remote.remoteHosts']

/**
 * Contribute the Remote hosts entry to the sidebar, and the panel it opens.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-remote-hosts: dictionaries')
  const t = ctx.locale.bind(NS)
  // One controller for the plugin's lifetime; its snapshot store is the only
  // reactive channel the panel reads, bound by the renderer as a hook.
  const controller = new RemoteHostsController(ctx)
  ctx.effect(() => () => { controller.dispose() }, 'ui-remote-hosts: controller')

  // The panel is a global panel: it belongs to the profile, not to a Session,
  // and the sidebar's entry selects it.
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: NS,
    inject: () => controller.inject(),
  }, RemoteHostsPanel))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 1,
    label: () => t('panel'),
    locale: NS,
  }, RemoteHostsIcon))
}
