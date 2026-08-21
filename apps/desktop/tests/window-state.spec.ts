import { describe, expect, it } from 'vitest'
import { createDesktopWindowStateStore, normalizeWindowState } from '../src/window-state.ts'

describe('desktop window state', () => {
  it('restores only bounded geometry and desktop-owned view state', () => {
    expect(normalizeWindowState({
      bounds: { x: -5000, y: -5000, width: 40, height: 9000 },
      activeWorkspaceId: 'workspace',
      activeSessionId: 'session',
      sourceListVisible: false,
      inspectorVisible: true,
      sourceListWidth: 9999,
      inspectorWidth: 1,
    }, { x: 0, y: 0, width: 1440, height: 900 })).toEqual({
      bounds: { x: 0, y: 0, width: 640, height: 900 },
      activeWorkspaceId: 'workspace',
      activeSessionId: 'session',
      sourceListVisible: false,
      inspectorVisible: true,
      sourceListWidth: 500,
      inspectorWidth: 340,
    })
  })

  it('normalizes persisted JSON before returning or rewriting desktop-local state', async () => {
    const writes: unknown[] = []
    const store = createDesktopWindowStateStore({
      read: async () => '{"bounds":{"width":1,"height":1}}',
      write: async (value) => { writes.push(value) },
    }, { x: 0, y: 0, width: 1440, height: 900 })

    await expect(store.load()).resolves.toMatchObject({ bounds: { width: 640, height: 480 } })
    await store.save({ bounds: { x: 0, y: 0, width: 9999, height: 1 }, sourceListWidth: 1 })

    expect(writes).toEqual([expect.objectContaining({
      bounds: { x: 0, y: 0, width: 1440, height: 480 },
      sourceListWidth: 220,
    })])
  })

  it('merges a partial renderer state update with persisted bounds and preferences', async () => {
    const writes: unknown[] = []
    const store = createDesktopWindowStateStore({
      read: async () => JSON.stringify({
        bounds: { x: 12, y: 34, width: 900, height: 700 },
        activeWorkspaceId: 'workspace',
        sourceListVisible: false,
        inspectorVisible: true,
        sourceListWidth: 320,
        inspectorWidth: 500,
      }),
      write: async (value) => { writes.push(value) },
    }, { x: 0, y: 0, width: 1440, height: 900 })

    await expect(store.save({ bounds: { width: 777, height: 555 } })).resolves.toMatchObject({
      bounds: { x: 12, y: 34, width: 777, height: 555 },
      activeWorkspaceId: 'workspace',
      sourceListVisible: false,
      inspectorVisible: true,
      sourceListWidth: 320,
      inspectorWidth: 500,
    })
    expect(writes).toHaveLength(1)
  })
})
