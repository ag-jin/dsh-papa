/** Validated desktop-local window restoration state. */

/** Rectangle bounded by a visible Electron work area. */
export interface DesktopBounds {
  /** Horizontal origin in display coordinates. */
  x: number
  /** Vertical origin in display coordinates. */
  y: number
  /** Width in CSS pixels. */
  width: number
  /** Height in CSS pixels. */
  height: number
}

/** Desktop-owned state that may be persisted outside DSH storage. */
export interface DesktopWindowState {
  /** Restored Electron window bounds. */
  bounds: DesktopBounds
  /** Selected DSH workspace identity, when one was active. */
  activeWorkspaceId?: string
  /** Selected DSH session identity, when one was active. */
  activeSessionId?: string
  /** Whether the source list is visible. */
  sourceListVisible: boolean
  /** Whether the contextual inspector is visible. */
  inspectorVisible: boolean
  /** Persisted source-list width in CSS pixels. */
  sourceListWidth: number
  /** Persisted inspector width in CSS pixels. */
  inspectorWidth: number
}

/** Persistence operations owned by the Electron main process. */
export interface DesktopWindowStateStorage {
  /** Reads one serialized desktop-local state document. */
  read(): Promise<string>
  /** Replaces the state document with validated desktop-only data. */
  write(state: DesktopWindowState): Promise<void>
}

/** Accessor for normalized desktop-local state. */
export interface DesktopWindowStateStore {
  /** Loads persisted state or defaults when the local document is unavailable. */
  load(): Promise<DesktopWindowState>
  /** Normalizes and persists a renderer-provided state candidate. */
  save(value: unknown): Promise<DesktopWindowState>
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
}

function bounded(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const candidate = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.min(Math.max(candidate, minimum), maximum)
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Normalizes untrusted persisted desktop data to one visible display work area.
 * @param value - Unknown JSON decoded from Electron-local storage.
 * @param workArea - Current display work area used to keep restored geometry visible.
 * @returns Bounded desktop-only state with no DSH transcript or credential data.
 */
export function normalizeWindowState(value: unknown, workArea: DesktopBounds): DesktopWindowState {
  const state = record(value)
  const storedBounds = record(state.bounds)
  const minimumWidth = Math.min(640, workArea.width)
  const minimumHeight = Math.min(480, workArea.height)
  const width = bounded(storedBounds.width, Math.min(1200, workArea.width), minimumWidth, workArea.width)
  const height = bounded(storedBounds.height, Math.min(800, workArea.height), minimumHeight, workArea.height)
  const x = bounded(storedBounds.x, workArea.x, workArea.x, workArea.x + workArea.width - width)
  const y = bounded(storedBounds.y, workArea.y, workArea.y, workArea.y + workArea.height - height)
  const activeWorkspaceId = optionalText(state.activeWorkspaceId)
  const activeSessionId = optionalText(state.activeSessionId)
  return {
    bounds: { x, y, width, height },
    ...(activeWorkspaceId === undefined ? {} : { activeWorkspaceId }),
    ...(activeSessionId === undefined ? {} : { activeSessionId }),
    sourceListVisible: state.sourceListVisible !== false,
    inspectorVisible: state.inspectorVisible === true,
    sourceListWidth: bounded(state.sourceListWidth, 280, 220, 500),
    inspectorWidth: bounded(state.inspectorWidth, 420, 340, 1200),
  }
}

function mergeWindowState(current: DesktopWindowState, update: unknown): Record<string, unknown> {
  const next = record(update)
  return {
    ...current,
    ...next,
    bounds: { ...current.bounds, ...record(next.bounds) },
  }
}

/**
 * Creates a persistence adapter that stores only normalized desktop-local state.
 * @param storage - Main-process storage adapter for the local state document.
 * @param workArea - Current visible display work area.
 * @returns State accessor that bounds every loaded and saved value.
 */
export function createDesktopWindowStateStore(storage: DesktopWindowStateStorage, workArea: DesktopBounds): DesktopWindowStateStore {
  return {
    async load() {
      try {
        return normalizeWindowState(JSON.parse(await storage.read()), workArea)
      } catch {
        // The optional local view-state file may be absent or malformed; startup uses visible defaults.
        return normalizeWindowState({}, workArea)
      }
    },
    async save(value) {
      const state = normalizeWindowState(mergeWindowState(await this.load(), value), workArea)
      await storage.write(state)
      return state
    },
  }
}
