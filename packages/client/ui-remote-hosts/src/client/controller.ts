/**
 * The remote-host switcher's state: the configured hosts as the Host answers
 * them, the action in flight, the host the frame shows, and the last refused
 * action. Every fact comes from the Host through the `remoteHosts` Remote,
 * and the store re-reads after each action, so a change made on another
 * surface shows here without a manual refresh.
 * @module @deepseek-ai/dsh-client-ui-remote-hosts/client/controller
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { RemoteHostRow } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'

/** The action a failure names. */
export type RemoteHostsAction = 'add' | 'connect' | 'disconnect' | 'remove'

/** The last refused action, with the Host's failure code when it refused. */
export interface RemoteHostsFailure {
  readonly action: RemoteHostsAction
  readonly code?: string
}

/** What the panel renders. */
export interface RemoteHostsState {
  /** `error` keeps the last rows; a retry re-reads. */
  readonly status: 'idle' | 'loading' | 'ready' | 'error'
  readonly rows: readonly RemoteHostRow[]
  /** Host ids — and the add form's `add` key — with a write crossing the wire. */
  readonly busy: readonly string[]
  /** The connected host the frame shows; null hides the frame. */
  readonly active: string | null
  /** The tunnel origin the frame loads; present exactly while `active` is. */
  readonly frameOrigin: string | null
  readonly failure: RemoteHostsFailure | null
}

/** The add form's fields; the controller mints the durable record's id. */
export interface RemoteHostDraft {
  readonly label: string
  readonly host: string
  readonly port: number
  readonly user: string
  readonly remotePort: number
  readonly localPort: number
  readonly password: string
}

/** The registration-side face the panel's slot entry injects. */
export interface RemoteHostsFace {
  hooks: {
    /** Panel snapshot bound by the renderer as useRemoteHosts. */
    remoteHosts: SnapshotStore<RemoteHostsState>
  }
  /** Read the Host once the panel first renders. */
  ensure: () => void
  /** Read the Host again. */
  refresh: () => void
  /** Open one host's tunnel and point the frame at it. */
  connect: (id: string) => void
  /** Close one host's tunnel and close the frame when it shows that host. */
  disconnect: (id: string) => void
  /** Forget one host, its stored password, and its tunnel. */
  remove: (id: string) => void
  /** Store a new host with its password, minting its id. */
  add: (draft: RemoteHostDraft) => void
}

const IDLE: RemoteHostsState = {
  status: 'idle', rows: [], busy: [], active: null, frameOrigin: null, failure: null,
}

/**
 * The id prefix of every host the panel adds. The record id doubles as a
 * credential-key segment — lowercase letters, digits, and hyphens, starting
 * with a letter — and the operator never sees it, so the panel mints one
 * instead of deriving it from a display label of any script.
 */
const ID_PREFIX = 'host-'

/** Reads and mutates the configured hosts through the `remoteHosts` Remote. */
export class RemoteHostsController {
  private readonly store: SnapshotStore<RemoteHostsState>
  /** Monotonic read counter; a superseded read's settlement is dropped. */
  private generation = 0
  /** Monotonic write counter; a superseded write's settlement is dropped. */
  private epoch = 0
  private disposed = false

  /**
   * Whether this controller has been disposed. Reading through a method keeps
   * the check honest across an `await`: control-flow narrowing of the field
   * would otherwise treat a disposal that landed mid-call as impossible.
   * @returns true once disposal ran.
   */
  private isDisposed(): boolean { return this.disposed }

  /**
   * @param ctx - the browser plugin context whose `remote.remoteHosts` namespace answers.
   */
  constructor(private readonly ctx: ClientContext) {
    this.store = createSnapshotStore<RemoteHostsState>(IDLE)
  }

  /**
   * Read the panel's state.
   * @returns the current sync snapshot (stable reference until the next change).
   */
  getSnapshot(): RemoteHostsState {
    return this.store.getSnapshot()
  }

  /** Stop publishing and drop every late settlement. */
  dispose(): void {
    this.disposed = true
    this.generation += 1
    this.epoch += 1
  }

  /**
   * Build the face the panel's slot registration injects.
   * @returns the panel's snapshot source and its actions.
   */
  inject(): RemoteHostsFace {
    return {
      hooks: { remoteHosts: this.store },
      ensure: () => { if (this.getSnapshot().status === 'idle') void this.load() },
      refresh: () => { void this.load() },
      connect: (id) => { void this.connect(id) },
      disconnect: (id) => { void this.disconnect(id) },
      remove: (id) => { void this.remove(id) },
      add: (draft) => { void this.add(draft) },
    }
  }

  /**
   * Read the configured hosts and whether their tunnels are live. A call
   * during an in-flight read supersedes it: only the newest answer lands.
   * @returns settlement after the newest answer is reflected.
   */
  async load(): Promise<void> {
    if (this.isDisposed()) return
    const generation = ++this.generation
    if (this.getSnapshot().status === 'idle') this.patch({ status: 'loading' })
    const result = await this.ctx.remote.remoteHosts.list()
    // Read through the accessor: control-flow narrowing of the field would
    // otherwise hide the disposal that can land while the call was in flight.
    if (this.isDisposed() || generation !== this.generation) return
    if (!result.ok) {
      this.patch({ status: 'error' })
      return
    }
    this.patch({ status: 'ready', rows: result.value })
  }

  /** Claim the write epoch; the settlement of a superseded write is dropped. */
  private take(): number {
    return ++this.epoch
  }

  /** Whether the write of this epoch is still the newest one and the store still publishes. */
  private current(epoch: number): boolean {
    return !this.isDisposed() && epoch === this.epoch
  }

  /**
   * Run one write under a busy key: word its refusal in the store as the
   * action's failure, hand its answer to `settle` for the state it changes,
   * and re-read the Host afterwards whatever happened. A write another write
   * superseded, or one taken after disposal, settles nowhere.
   * @param key - the busy key, one host id or the add form's `add`.
   * @param action - what was being done, naming a refusal.
   * @param call - the Remote call.
   * @param settle - the state a successful answer changes, or null for none.
   */
  private async run<T>(
    key: string,
    action: RemoteHostsAction,
    call: () => Promise<{ readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: { readonly code: string } }>,
    settle: (value: T) => Partial<RemoteHostsState> | null,
  ): Promise<void> {
    if (this.isDisposed() || this.getSnapshot().busy.includes(key)) return
    const epoch = this.take()
    this.patch({ busy: [...this.getSnapshot().busy, key], failure: null })
    try {
      const answer = await call()
      if (this.current(epoch)) {
        if (!answer.ok) {
          this.patch({ failure: { action, code: answer.error.code } })
        } else {
          const next = settle(answer.value)
          if (next !== null) this.patch(next)
        }
      }
    } finally {
      this.patch({ busy: this.getSnapshot().busy.filter(entry => entry !== key) })
    }
    await this.load()
  }

  private connect(id: string): Promise<void> {
    return this.run(
      id,
      'connect',
      () => this.ctx.remote.remoteHosts.connect(id),
      connection => ({ active: id, frameOrigin: connection.origin }),
    )
  }

  private disconnect(id: string): Promise<void> {
    return this.run(
      id,
      'disconnect',
      () => this.ctx.remote.remoteHosts.disconnect(id),
      () => this.getSnapshot().active === id ? { active: null, frameOrigin: null } : null,
    )
  }

  private remove(id: string): Promise<void> {
    return this.run(
      id,
      'remove',
      () => this.ctx.remote.remoteHosts.delete(id),
      () => this.getSnapshot().active === id ? { active: null, frameOrigin: null } : null,
    )
  }

  private add(draft: RemoteHostDraft): Promise<void> {
    return this.run(
      'add',
      'add',
      () => this.ctx.remote.remoteHosts.add({ id: `${ID_PREFIX}${randomUUID()}`, ...draft }),
      () => null,
    )
  }

  private patch(next: Partial<RemoteHostsState>): void {
    if (this.isDisposed()) return
    this.store.set({ ...this.getSnapshot(), ...next })
  }
}
