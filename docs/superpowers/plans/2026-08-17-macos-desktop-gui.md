# macOS Desktop GUI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Build a signed, Mac-first Electron application that hosts a local DSH runtime without a network listener and presents the existing plugin-composed client as a native desktop workbench for local independent developers.

**Architecture:** Electron main owns an application-scoped DesktopRuntimeSupervisor, a file-backed client-bundle catalog, native windows, and every privileged macOS operation. A context-isolated preload bridge carries the established API request-response protocol and the two downlink streams to a desktop API client inside the existing browser client composition. Desktop-specific UI contributes through declared client slots; it does not fork session, conversation, permission, or tool state.

**Tech Stack:** TypeScript, Electron, React 18, Cordis, Vite-built client bundles, Vitest, Playwright or Electron's test runner, macOS 14 on Apple silicon.

**Spec:** docs/superpowers/specs/2026-08-17-macos-desktop-gui-design.md

## Global Constraints

- Target Apple silicon systems running macOS 14 or later.
- Load the renderer and all client-plugin bundles from packaged local resources; DSH Desktop owns no listening TCP or UDP port.
- Keep context isolation enabled, disable renderer Node integration, and expose only a versioned, allowlisted preload bridge.
- DSH remains the owner of session logs, agent settings, credential references, workspace records, tool results, and background jobs.
- Electron user data holds desktop window and view preferences only; it excludes credentials, transcript copies, and tool-output caches.
- Keep the browser GUI as a supported client of the same DSH services and data.
- Compose UI through existing client slots, derived props, and declared stores. Do not add renderer React contexts, global store handles, or direct Electron calls in feature components.
- Product copy is Chinese; code comments and JSDoc are English.
- Update package README files, subsystem documentation, an Agent Note, and keyless assembled UI snapshots with every non-trivial product-visible change.
- Execute this plan from an attached Git worktree before issuing the listed commit commands.

---

## File Structure

- Create: packages/client/modules/src/catalog.ts - creates a host-only file-backed boot manifest from client rows and resolves an authorized bundle asset.
- Modify: packages/client/modules/src/index.ts - exports the catalog provider without coupling it to the web server.
- Modify: packages/client/modules/src/client/manifest.ts - documents local bundle URLs as an additional valid module source.
- Create: packages/client/connection/src/client/desktop-bridge.ts - declares the renderer-safe preload bridge contract and DshWindow extension.
- Create: packages/client/connection/src/client/desktop-api-client.ts - adapts bridge request-response and downlinks to AbstractApiClient.
- Modify: packages/client/connection/src/client/index.ts - selects fixture, desktop, or browser transport at boot.
- Create: packages/desktop/runtime/package.json - package manifest for the Electron main-process runtime provider.
- Create: packages/desktop/runtime/src/runtime.ts - owns the desktop Cordis composition, API dispatch, and shutdown state machine.
- Create: packages/desktop/runtime/src/bridge.ts - validates bridge calls and owns per-window downlink subscriptions.
- Create: packages/desktop/runtime/src/index.ts - exports the runtime provider and its documented service interface.
- Create: packages/bundle/desktop-app/cordis.patch.yml - composes DSH services and browser client rows without webserver, frontend-static, web-runtime, or HMR rows.
- Create: packages/bundle/desktop-app/package.json - declares the desktop bundle and every bare plugin dependency used by its composition.
- Create: apps/desktop/package.json - defines Electron build, test, development, and packaging scripts.
- Create: apps/desktop/src/main.ts - starts the runtime supervisor, registers secure protocols, creates and restores windows, and coordinates shutdown.
- Create: apps/desktop/src/preload.ts - exposes the bridge through contextBridge and validates renderer payloads before IPC forwarding.
- Create: apps/desktop/src/window-state.ts - persists desktop-only window and panel state.
- Create: apps/desktop/src/menu.ts - owns native macOS menus and dispatches declared desktop commands to the active renderer.
- Create: apps/desktop/src/protocol.ts - resolves only catalog-authorized client bundle files and packaged renderer assets.
- Create: apps/desktop/tests/desktop.e2e.ts - drives a fixture composition through Electron and proves the no-listener requirement.
- Create: packages/client/ui-desktop/package.json - desktop-only client plugin package.
- Create: packages/client/ui-desktop/src/client/DesktopChrome.tsx - renders the workbench toolbar, run state, and desktop command bindings.
- Create: packages/client/ui-desktop/src/client/ExecutionContextRow.tsx - presents workspace, preset, model, team or expert, and permission scopes outside the composer body.
- Create: packages/client/ui-desktop/src/client/desktop-store.ts - stores desktop-local inspector visibility and run context presentation state.
- Modify: packages/client/ui-layout/src/client/AppFrame.tsx - declares and renders toolbar and inspector-control slots without changing session state ownership.
- Modify: packages/client/ui-layout/src/client/stores.ts - accepts restored panel preferences through its declared store action API.
- Modify: packages/client/ui-sidebar/src/client/SidebarRoot.tsx - separates workspace/session navigation from stable plugin destinations.
- Modify: packages/client/ui-conversation/src/client/skeleton/ConversationRoot.tsx - renders the execution-context slot above the composer and removes the desktop oversized empty-state treatment.
- Modify: packages/client/ui-conversation/src/client/contract/slots.ts - declares the execution-context owner props and authorization path.
- Create: docs/subsystems/desktop-runtime.md - owns desktop runtime service, IPC and lifecycle reference documentation.
- Create: .agents/notes/implemented/feature/2026-08-17-macos-desktop-gui.md - records the desktop transport, privilege, and persistence decisions after implementation.

## Milestone 1: Transport and Runtime Foundation

### Task 1: Extract a file-backed client bundle catalog

**Files:**
- Create: packages/client/modules/src/client/catalog.ts
- Modify: packages/client/modules/src/index.ts
- Modify: packages/client/modules/src/client/manifest.ts
- Test: packages/client/modules/tests/catalog.client.spec.ts
- Test: packages/client/modules/tests/load-path.client.spec.ts

**Consumes:** Existing dsh.client manifest rows and the current WebBootGraph wire format.

**Produces:** ClientBundleCatalog with createBootGraph() and resolveBundle(id, rev), consumed by the Electron protocol handler and the existing browser modules route.

- [ ] **Step 1: Write catalog tests before extracting host code.**

~~~ts
it('creates a content-addressed boot graph from composed client rows', () => {
  const catalog = createClientBundleCatalog(entries)
  expect(catalog.createBootGraph().entries).toEqual([
    { id: '@deepseek-ai/dsh-client-runtime', url: 'dsh-client://bundle/runtime.js', rev: 'abc' },
  ])
})

it('rejects an unknown package id or mismatched revision', () => {
  expect(() => catalog.resolveBundle('@deepseek-ai/dsh-client-unknown', 'abc')).toThrow('desktop bundle is not in the active client graph')
  expect(() => catalog.resolveBundle('@deepseek-ai/dsh-client-runtime', 'wrong')).toThrow('desktop bundle revision mismatch')
})
~~~

- [ ] **Step 2: Run the focused tests and confirm the missing catalog failure.**

Run: pnpm exec vitest run packages/client/modules/tests/catalog.client.spec.ts

Expected: FAIL because createClientBundleCatalog is not exported.

- [ ] **Step 3: Implement the catalog as a host-only provider.**

~~~ts
export interface ClientBundleCatalog {
  createBootGraph(): WebBootGraph
  resolveBundle(id: string, rev: string): URL
}

export function createClientBundleCatalog(entries: readonly ClientEntry[]): ClientBundleCatalog {
  const byId = new Map(entries.map(entry => [entry.id, entry]))
  return {
    createBootGraph: () => ({ rev: graphRevision(entries), entries: entries.map(toBootEntry) }),
    resolveBundle: (id, rev) => resolveCatalogBundle(byId, id, rev),
  }
}
~~~

Keep path discovery, realpath containment, and content-hash validation inside the catalog. The web route and Electron protocol handler receive only the catalog interface.

- [ ] **Step 4: Refactor the current modules host path to build its injected boot graph from ClientBundleCatalog.**

Preserve existing browser URLs and HMR behavior. Add no Electron imports to packages/client/modules.

- [ ] **Step 5: Run module tests and client build checks.**

Run: pnpm exec vitest run packages/client/modules/tests/catalog.client.spec.ts packages/client/modules/tests/load-path.client.spec.ts

Run: pnpm exec tsc -p packages/client/modules/tsconfig.json --noEmit

Expected: PASS.

- [ ] **Step 6: Commit the extraction.**

~~~bash
git add packages/client/modules
git commit -m "refactor: extract client bundle catalog"
~~~

### Task 2: Add the desktop API transport to the client connection package

**Files:**
- Create: packages/client/connection/src/client/desktop-bridge.ts
- Create: packages/client/connection/src/client/desktop-api-client.ts
- Modify: packages/client/connection/src/client/index.ts
- Test: packages/client/connection/tests/desktop-api-client.client.spec.ts
- Test: packages/client/connection/tests/connection.client.spec.ts

**Consumes:** AbstractApiClient, event frame schemas, and the catalog-provided local client bundles from Task 1.

**Produces:** DesktopApiClient and the global DesktopBridge declaration. The existing connection plugin selects DesktopApiClient only when the preload bridge exists.

- [ ] **Step 1: Write tests for request forwarding, downlink ordering, malformed event rejection, and abort propagation.**

~~~ts
it('sends unary calls through the desktop bridge without a network request', async () => {
  const bridge = fakeDesktopBridge({ response: rpcOk({ name: 'DSH Desktop' }) })
  const client = new DesktopApiClient(bridge)
  await expect(client.host.describe({})).resolves.toEqual({ name: 'DSH Desktop' })
  expect(bridge.requests).toHaveLength(1)
})

it('ends the event iterable when its bridge subscription closes', async () => {
  const bridge = fakeDesktopBridge()
  const client = new DesktopApiClient(bridge)
  const iterator = client.events.mux({}, new AbortController().signal)[Symbol.asyncIterator]()
  bridge.close('mux')
  await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
})
~~~

- [ ] **Step 2: Run the test file and confirm that the desktop transport is absent.**

Run: pnpm exec vitest run packages/client/connection/tests/desktop-api-client.client.spec.ts

Expected: FAIL because DesktopApiClient and DesktopBridge do not exist.

- [ ] **Step 3: Define the renderer-safe bridge contract.**

~~~ts
export interface DesktopBridge {
  request(request: DesktopRequest): Promise<DesktopResponse>
  subscribe(kind: 'mux' | 'host', listener: (message: unknown) => void, onClose: () => void): () => void
  sendCommand(command: DesktopCommand): Promise<void>
  getWindowState(): Promise<DesktopWindowState>
  setWindowState(state: DesktopWindowState): Promise<void>
}

declare global {
  interface Window {
    __DSH_DESKTOP__?: DesktopBridge
  }
}
~~~

The values contain only JSON-compatible wire data. Do not place Electron, Node, EventEmitter, file-path, or callback objects on window.

- [ ] **Step 4: Implement DesktopApiClient as an AbstractApiClient subclass.**

Map doFetch to DesktopBridge.request. Reuse the existing API schemas when parsing responses. Build mux and host AsyncIterable queues with the same abort cleanup behavior as WebApiClient. Call onEnvelope for each accepted server request.

- [ ] **Step 5: Update connection apply selection without weakening fixture behavior.**

~~~ts
const desktopBridge = window.__DSH_DESKTOP__
const api: IApiClient = fixtureClient ?? (desktopBridge === undefined ? new WebApiClient() : new DesktopApiClient(desktopBridge))
~~~

Keep fixture mode first so web test fixtures remain hermetic. Set isLoopback to true for the desktop bridge because no browser origin participates in its authorization model.

- [ ] **Step 6: Run focused tests, then the GUI inner loop.**

Run: pnpm exec vitest run packages/client/connection/tests/desktop-api-client.client.spec.ts packages/client/connection/tests/connection.client.spec.ts

Run: pnpm run test:gui

Expected: PASS.

- [ ] **Step 7: Commit the client transport.**

~~~bash
git add packages/client/connection
git commit -m "feat: add desktop client transport"
~~~

### Task 3: Implement the main-process DSH runtime and IPC authority

**Files:**
- Create: packages/desktop/runtime/package.json
- Create: packages/desktop/runtime/src/runtime.ts
- Create: packages/desktop/runtime/src/bridge.ts
- Create: packages/desktop/runtime/src/index.ts
- Create: packages/desktop/runtime/src/invariant.ts
- Create: packages/desktop/runtime/tests/runtime.spec.ts
- Create: packages/desktop/runtime/tests/bridge.spec.ts
- Create: packages/bundle/desktop-app/package.json
- Create: packages/bundle/desktop-app/cordis.patch.yml
- Create: packages/bundle/desktop-app/README.md

**Consumes:** ApiProxy, toFetchHandler, ClientBundleCatalog, and the dsh-base bundle.

**Produces:** DesktopRuntimeSupervisor with start(), attachWindow(), detachWindow(), stop(), and state snapshots. The supervisor provides desktop bridge dispatch without mounting dsh-host-webserver.

- [ ] **Step 1: Write the runtime state-machine tests.**

~~~ts
it('starts the desktop composition without registering a web server', async () => {
  const runtime = new DesktopRuntimeSupervisor(options)
  await runtime.start()
  expect(runtime.snapshot().state).toBe('ready')
  expect(options.createContext).not.toHaveProvided('webServer')
})

it('stops new bridge requests before bounded runtime disposal', async () => {
  const runtime = readyRuntime()
  const stopping = runtime.stop()
  await expect(runtime.request(windowId, request)).rejects.toThrow('desktop runtime is stopping')
  await stopping
})
~~~

- [ ] **Step 2: Run the tests and confirm the supervisor is absent.**

Run: pnpm exec vitest run packages/desktop/runtime/tests/runtime.spec.ts packages/desktop/runtime/tests/bridge.spec.ts

Expected: FAIL because the package and service do not exist.

- [ ] **Step 3: Implement the explicit runtime lifecycle.**

~~~ts
export type DesktopRuntimeState = 'starting' | 'ready' | 'degraded' | 'stopping' | 'stopped'

export interface DesktopRuntimeSupervisor {
  start(): Promise<void>
  attachWindow(windowId: string, publish: DesktopDownlinkPublisher): () => void
  request(windowId: string, request: DesktopRequest): Promise<DesktopResponse>
  snapshot(): DesktopRuntimeSnapshot
  stop(): Promise<void>
}
~~~

Activate the desktop bundle over dsh-base. Do not import Electron into the Cordis package. Obtain ApiProxy through its documented service and call toFetchHandler only in the bridge adapter.

- [ ] **Step 4: Implement bridge validation and per-window downlinks.**

Validate operation names, request envelope schema, sender window identity, stream kind, and unsubscribe ownership before touching ApiProxy. Give every subscription a disposer. On window detach, abort both downlink sources and remove their handlers before returning.

- [ ] **Step 5: Compose the desktop bundle from the web feature roster without Web-only rows.**

Copy only host services and dsh.client rows required by the existing UI. Exclude webserver, frontend-static, web-startup, web-runtime, client-hmr, and any trust configuration that assumes HTTP origins. Add the new desktop runtime row and preserve the same client feature rows.

- [ ] **Step 6: Add runtime invariant and README.**

The invariant proves that a ready DesktopRuntimeSupervisor has an active ApiProxy and no WebServer service. The README documents model effect, desktop no-listener behavior, lifecycle failure states, and the bridge permission boundary.

- [ ] **Step 7: Run package, bundle, and GUI tests.**

Run: pnpm exec vitest run packages/desktop/runtime/tests/runtime.spec.ts packages/desktop/runtime/tests/bridge.spec.ts

Run: pnpm run test:gui

Expected: PASS.

- [ ] **Step 8: Commit the desktop runtime boundary.**

~~~bash
git add packages/desktop/runtime packages/bundle/desktop-app
git commit -m "feat: add desktop DSH runtime"
~~~

### Task 4: Build the Electron application shell and local resource protocol

**Files:**
- Create: apps/desktop/package.json
- Create: apps/desktop/src/main.ts
- Create: apps/desktop/src/preload.ts
- Create: apps/desktop/src/protocol.ts
- Create: apps/desktop/src/window-state.ts
- Create: apps/desktop/src/global.d.ts
- Create: apps/desktop/tests/preload.spec.ts
- Create: apps/desktop/tests/protocol.spec.ts
- Create: apps/desktop/tests/window-state.spec.ts

**Consumes:** DesktopRuntimeSupervisor and ClientBundleCatalog from Tasks 1 and 3, plus the Vite-built apps/web renderer output.

**Produces:** A macOS Electron process that loads the renderer from packaged files, injects the boot graph, serves authorized plugin bundles through a privileged local protocol, and exposes the versioned bridge through preload.

- [ ] **Step 1: Write security and protocol tests.**

~~~ts
it('registers only packaged renderer and active catalog files', async () => {
  const response = await protocol.fetch('dsh-client://bundle/%40deepseek-ai%2Fdsh-client-runtime?rev=abc')
  expect(await response.text()).toContain('__ModuleLoader__')
  await expect(protocol.fetch('dsh-client://bundle/etc/passwd?rev=abc')).rejects.toThrow('desktop bundle is not in the active client graph')
})

it('exposes no arbitrary ipc renderer API', () => {
  expect(exposedKeys(preloadWindow)).toEqual(['request', 'subscribe', 'sendCommand', 'getWindowState', 'setWindowState'])
})
~~~

- [ ] **Step 2: Run the tests and confirm the app shell is absent.**

Run: pnpm exec vitest run apps/desktop/tests/preload.spec.ts apps/desktop/tests/protocol.spec.ts apps/desktop/tests/window-state.spec.ts

Expected: FAIL because apps/desktop does not exist.

- [ ] **Step 3: Define the Electron package build graph.**

Add Electron, Electron Forge, TypeScript build outputs, and a test command to apps/desktop/package.json. Make the package depend on the built apps/web renderer, the desktop bundle, and desktop runtime. Add each dependency requiring a lifecycle script to pnpm-workspace allowBuilds before installation.

- [ ] **Step 4: Implement secure protocols and window creation.**

Register the local client-bundle protocol before BrowserWindow construction. Resolve only assets from the packaged renderer root and bundle URLs from ClientBundleCatalog. Create BrowserWindow with contextIsolation true, nodeIntegration false, sandbox true, a preload path, and a Content Security Policy that permits only the packaged renderer and local client protocol.

- [ ] **Step 5: Implement preload as a narrow serializer.**

Use contextBridge.exposeInMainWorld with the DesktopBridge contract. Serialize request payloads, invoke only fixed IPC channel names, return plain JSON, and register an unsubscribe for each event subscription. Never expose ipcRenderer, shell, dialog, process, require, or arbitrary channel methods.

- [ ] **Step 6: Inject the boot graph before running AppWebEntry.**

Generate window.__DSH_BOOT__ from ClientBundleCatalog in preload or a generated renderer bootstrap asset. Use dsh-client URLs for plugin bundles so the existing ClientModuleSystem script-loader path remains active without an HTTP server.

- [ ] **Step 7: Add desktop-only window state persistence.**

Persist geometry, active workspace identifier, active session identifier, source-list visibility, inspector visibility, and panel widths after validated changes. Validate restored bounds against the current display work area before creating a window.

- [ ] **Step 8: Run app tests and build the renderer plus Electron main process.**

Run: pnpm exec vitest run apps/desktop/tests/preload.spec.ts apps/desktop/tests/protocol.spec.ts apps/desktop/tests/window-state.spec.ts

Run: pnpm --filter @deepseek-ai/dsh-web-frontend run build

Run: pnpm --filter @deepseek-ai/dsh-desktop run build

Expected: PASS.

- [ ] **Step 9: Commit the secure application shell.**

~~~bash
git add apps/desktop pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "feat: add Electron desktop shell"
~~~

### Task 5: Prove the assembled desktop transport end to end

**Files:**
- Create: apps/desktop/tests/desktop.e2e.ts
- Create: apps/desktop/tests/fixtures/desktop.cordis.yml
- Modify: apps/desktop/package.json
- Modify: package.json

**Consumes:** Every foundation component from Tasks 1 through 4.

**Produces:** A real-process smoke lane that proves the renderer uses the desktop bridge, sessions stream, tool execution works with fixture data, and DSH Desktop opens no listener.

- [ ] **Step 1: Create the failing assembled Electron scenario.**

~~~ts
it('boots a local session through IPC with no listening DSH port', async () => {
  const app = await launchDesktop({ fixture: 'desktop.cordis.yml' })
  await expect(app.window.getByRole('textbox')).toBeVisible()
  await app.window.getByRole('textbox').fill('create a file')
  await app.window.getByRole('button', { name: 'Send' }).click()
  await expect(app.window.getByText('tool result')).toBeVisible()
  expect(await listeningPortsOwnedBy(app.pid)).toEqual([])
})
~~~

- [ ] **Step 2: Run the scenario and confirm the assembled app does not start yet.**

Run: pnpm --filter @deepseek-ai/dsh-desktop test:e2e -- desktop.e2e.ts

Expected: FAIL because Electron launch or the desktop composition is unavailable.

- [ ] **Step 3: Build fixture helpers that start the packaged main process, not dsh web.**

The helper waits for the renderer readiness signal and cleans up every Electron child process. It never starts a Vite server and never connects to port 3080.

- [ ] **Step 4: Add cases for renderer reload, approval delivery, bridge rejection, and clean shutdown.**

Assert that renderer reload reconnects to the application-scoped runtime, an approval appears in the active session, undeclared bridge channels fail, and window shutdown leaves durable session data intact.

- [ ] **Step 5: Run the full desktop foundation lane.**

Run: pnpm --filter @deepseek-ai/dsh-desktop test:e2e

Run: pnpm run test:gui

Expected: PASS.

- [ ] **Step 6: Commit the foundation acceptance tests.**

~~~bash
git add apps/desktop/tests apps/desktop/package.json package.json
git commit -m "test: cover desktop IPC boot"
~~~

## Milestone 2: Mac Workbench Experience

### Task 6: Add the desktop toolbar, native command bridge, and restored panel geometry

**Files:**
- Create: packages/client/ui-desktop/package.json
- Create: packages/client/ui-desktop/src/client/index.ts
- Create: packages/client/ui-desktop/src/client/DesktopChrome.tsx
- Create: packages/client/ui-desktop/src/client/desktop-store.ts
- Create: packages/client/ui-desktop/src/client/DesktopChrome.module.css
- Modify: packages/client/ui-layout/src/client/AppFrame.tsx
- Modify: packages/client/ui-layout/src/client/stores.ts
- Modify: apps/desktop/src/menu.ts
- Modify: apps/desktop/src/main.ts
- Test: packages/client/ui-desktop/tests/desktop-chrome.client.spec.tsx
- Test: packages/client/ui-layout/tests/layout.client.spec.tsx
- Test: apps/desktop/tests/menu.spec.ts

**Consumes:** DesktopBridge from Task 2 and restored DesktopWindowState from Task 4.

**Produces:** A native-command-backed toolbar with source-list and inspector toggles, active run status, command search, and synchronized persistent panel settings.

- [ ] **Step 1: Write component and menu tests.**

~~~tsx
it('sends the inspector command through the desktop bridge', async () => {
  const bridge = fakeDesktopBridge()
  render(<DesktopChrome {...props({ bridge })} />)
  await userEvent.click(screen.getByRole('button', { name: '显示检查器' }))
  expect(bridge.commands).toContainEqual({ kind: 'toggle-inspector' })
})

it('dispatches the View inspector menu item only to the focused renderer', async () => {
  const menu = createDesktopMenu(windows)
  menu.invoke('view.toggleInspector')
  expect(windows.focused().commands).toEqual([{ kind: 'toggle-inspector' }])
})
~~~

- [ ] **Step 2: Run the focused tests and confirm the desktop UI package is missing.**

Run: pnpm exec vitest run packages/client/ui-desktop/tests/desktop-chrome.client.spec.tsx apps/desktop/tests/menu.spec.ts

Expected: FAIL because ui-desktop and the menu dispatcher do not exist.

- [ ] **Step 3: Extend the layout slot contract.**

Declare shell.toolbar and shell.inspector-control as children of the existing root layout registration. Render them from AppFrame with derived slot props. Keep source list, conversation, and details column ownership unchanged.

- [ ] **Step 4: Create the desktop presentation store.**

~~~ts
export interface DesktopPresentationState {
  inspectorVisible: boolean
  sourceListVisible: boolean
  commandPaletteOpen: boolean
}

export function createDesktopPresentationStore(initial: DesktopPresentationState) {
  return defineStore(initial, actions => ({
    setInspectorVisible: actions.setInspectorVisible,
    setSourceListVisible: actions.setSourceListVisible,
    setCommandPaletteOpen: actions.setCommandPaletteOpen,
  }))
}
~~~

Create its handle inside the ui-desktop apply function and pass it through declared PropsStore shares only.

- [ ] **Step 5: Implement native menu ownership.**

Create File, Edit, View, Session, and Window menu templates in apps/desktop/src/menu.ts. Standard edit commands use Electron roles. DSH-specific items send fixed DesktopCommand values to the focused renderer. Disable commands when there is no focused ready window.

- [ ] **Step 6: Restore layout preferences through typed bridge state.**

On desktop plugin activation, read DesktopWindowState once and seed store actions. Persist changes after state transitions, not during render. Existing browser sessions retain transient geometry because the desktop bridge is absent.

- [ ] **Step 7: Run focused tests and the GUI inner loop.**

Run: pnpm exec vitest run packages/client/ui-desktop/tests/desktop-chrome.client.spec.tsx packages/client/ui-layout/tests/layout.client.spec.tsx apps/desktop/tests/menu.spec.ts

Run: pnpm run test:gui

Expected: PASS.

- [ ] **Step 8: Commit toolbar and native command support.**

~~~bash
git add packages/client/ui-desktop packages/client/ui-layout apps/desktop
git commit -m "feat: add desktop workbench chrome"
~~~

### Task 7: Reorganize the source list and contextual inspector for local development

**Files:**
- Modify: packages/client/ui-sidebar/src/client/SidebarRoot.tsx
- Modify: packages/client/ui-sidebar/src/client/SidebarRoot.module.css
- Modify: packages/client/ui-conversation/src/client/skeleton/DetailsPanel.tsx
- Modify: packages/client/ui-layout/src/client/AppFrame.tsx
- Test: packages/client/ui-sidebar/tests/sidebar-root.client.spec.tsx
- Test: packages/client/ui-conversation/tests/details-panel.client.spec.tsx
- Test: apps/web/tests/navigation-panes.e2e.ts

**Consumes:** Existing workspace and session hooks, plus desktop panel state from Task 6 when available.

**Produces:** A two-level source list where workspace and session navigation remains primary and plugin destinations occupy a distinct secondary group. The right panel acts as a hideable contextual inspector.

- [ ] **Step 1: Add failing sidebar tests for hierarchy and keyboard labels.**

~~~tsx
it('groups workspace sessions before secondary plugin destinations', () => {
  render(<SidebarRoot {...props} />)
  expect(screen.getByRole('navigation', { name: '工作区与会话' })).toContainElement(screen.getByText('当前项目'))
  expect(screen.getByRole('navigation', { name: '工具' })).toContainElement(screen.getByText('SSH'))
})

it('gives each compact-rail icon an accessible name and tooltip', () => {
  render(<SidebarRoot {...collapsedProps} />)
  expect(screen.getByRole('button', { name: '新建会话' })).toHaveAttribute('title', '新建会话')
})
~~~

- [ ] **Step 2: Run the test and confirm the new navigation regions are absent.**

Run: pnpm exec vitest run packages/client/ui-sidebar/tests/sidebar-root.client.spec.tsx

Expected: FAIL because the source list has no separate navigation groups.

- [ ] **Step 3: Add declared sidebar extension seats.**

Keep workspace and session rows in the existing sidebar domain. Add a named secondary destination slot rather than importing plugin UI packages into ui-sidebar. Provide only plain ids, selection state, and command callbacks through owner props.

- [ ] **Step 4: Make details a contextual inspector.**

Preserve current Files, Changes, and plugin detail contributions. Add an inspector tab header whose active tab derives from the selected conversation item or explicit user choice. A hidden inspector renders no visible width and restores its last valid desktop width when reopened.

- [ ] **Step 5: Remove desktop-sized empty-state treatment.**

Keep the empty conversation functional, but reduce hero presentation to a compact workspace/session prompt in desktop mode. The browser fallback keeps its existing behavior until its own product decision changes.

- [ ] **Step 6: Run component, GUI, and assembled visual tests.**

Run: pnpm exec vitest run packages/client/ui-sidebar/tests/sidebar-root.client.spec.tsx packages/client/ui-conversation/tests/details-panel.client.spec.tsx

Run: pnpm run test:gui

Run: DSH_SNAPSHOT=replay pnpm run test:web

Expected: PASS. Update only the expected snapshots that capture intentional desktop-neutral layout changes.

- [ ] **Step 7: Commit source list and inspector behavior.**

~~~bash
git add packages/client/ui-sidebar packages/client/ui-conversation packages/client/ui-layout apps/web/tests
git commit -m "feat: organize desktop workspace navigation"
~~~

### Task 8: Consolidate execution context and run-state recovery

**Files:**
- Create: packages/client/ui-desktop/src/client/ExecutionContextRow.tsx
- Create: packages/client/ui-desktop/src/client/RunStateControl.tsx
- Modify: packages/client/ui-conversation/src/client/contract/slots.ts
- Modify: packages/client/ui-conversation/src/client/skeleton/ConversationRoot.tsx
- Modify: packages/client/ui-conversation/src/client/skeleton/InputBar.tsx
- Modify: packages/client/ui-permission-presets/src/client/PermissionRow.tsx
- Modify: packages/client/ui-model-selection/src/client/ModelSelect.tsx
- Test: packages/client/ui-desktop/tests/execution-context.client.spec.tsx
- Test: packages/client/ui-conversation/tests/conversation-root.client.spec.tsx
- Test: apps/desktop/tests/recovery.e2e.ts

**Consumes:** Existing preset, model, permission, workspace, expert, and session services. It does not add a parallel persistence model.

**Produces:** One compact execution-context surface stating next-run, session, workspace, or profile scope for every selected option, plus visible run states and recovery actions.

- [ ] **Step 1: Write failing scope and risk tests.**

~~~tsx
it('labels a permission change with its actual session scope', () => {
  render(<ExecutionContextRow {...props({ permissionScope: 'session' })} />)
  expect(screen.getByText('权限：完全访问，仅当前会话')).toBeVisible()
})

it('keeps the composer focused on input and send actions', () => {
  render(<InputBar {...props} />)
  expect(screen.queryByRole('button', { name: '模型' })).toBeNull()
  expect(screen.getByRole('button', { name: '发送' })).toBeVisible()
})
~~~

- [ ] **Step 2: Run the focused tests and confirm that the context row is absent.**

Run: pnpm exec vitest run packages/client/ui-desktop/tests/execution-context.client.spec.tsx packages/client/ui-conversation/tests/conversation-root.client.spec.tsx

Expected: FAIL because the execution-context slot and components do not exist.

- [ ] **Step 3: Declare a conversation.execution-context slot.**

Expose an optional-session owner prop carrying session id, active workspace id, composer phase, pending interactions, and the current run state. Render this slot above conversation.composer. Do not pass React nodes through owner props.

- [ ] **Step 4: Move presentation controls into the desktop contribution.**

Keep current model and permission services authoritative. Their UI contributors supply plain selected data and mutation callbacks to ExecutionContextRow through existing slot or inject faces. InputBar retains attachment, draft input, send, and stop only.

- [ ] **Step 5: Map durable lifecycle facts to one visible run state.**

Display running, waiting for approval, waiting for user, completed, failed, cancelled, and interrupted. A completed state never appears until the underlying session lifecycle has settled. Interrupted exposes Inspect and Resume only where the runtime provides those actions.

- [ ] **Step 6: Add recovery integration cases.**

Launch a fixture run, reload the renderer, restart the runtime supervisor, and force-close an unfinished run. Assert that reconnect displays projected history, the run is not displayed as completed, and a valid next action is offered.

- [ ] **Step 7: Run focused and assembled tests.**

Run: pnpm exec vitest run packages/client/ui-desktop/tests/execution-context.client.spec.tsx packages/client/ui-conversation/tests/conversation-root.client.spec.tsx

Run: pnpm --filter @deepseek-ai/dsh-desktop test:e2e -- recovery.e2e.ts

Run: pnpm run test:gui

Expected: PASS.

- [ ] **Step 8: Commit execution context and recovery UI.**

~~~bash
git add packages/client/ui-desktop packages/client/ui-conversation packages/client/ui-permission-presets packages/client/ui-model-selection apps/desktop/tests
git commit -m "feat: clarify desktop execution context"
~~~

## Milestone 3: Distribution and Documentation

### Task 9: Add macOS packaging, signing, notarization, and release smoke coverage

**Files:**
- Modify: apps/desktop/package.json
- Create: apps/desktop/forge.config.ts
- Create: apps/desktop/scripts/verify-macos-artifact.ts
- Create: apps/desktop/tests/packaged-macos.e2e.ts
- Modify: package.json
- Create: .github/workflows/release-desktop.yml
- Modify: docs/subsystems/desktop-runtime.md
- Create: .agents/notes/implemented/feature/2026-08-17-macos-desktop-gui.md

**Consumes:** A passing assembled Electron app from Tasks 1 through 8.

**Produces:** An Apple-silicon macOS application artifact that is signed, notarized, Gatekeeper-validated, and covered by a packaged-app smoke test.

- [ ] **Step 1: Write failing artifact-verification tests.**

~~~ts
it('rejects an unsigned or unnotarized desktop artifact', async () => {
  await expect(verifyMacosArtifact(unsignedApp)).rejects.toThrow('codesign verification failed')
})

it('starts the packaged application with no DSH listener', async () => {
  const app = await launchPackagedDesktop(artifact)
  await expect(app.window.getByRole('textbox')).toBeVisible()
  expect(await listeningPortsOwnedBy(app.pid)).toEqual([])
})
~~~

- [ ] **Step 2: Run the verifier test and confirm packaging support is absent.**

Run: pnpm --filter @deepseek-ai/dsh-desktop test:e2e -- packaged-macos.e2e.ts

Expected: FAIL because no packaged desktop artifact exists.

- [ ] **Step 3: Configure an arm64 macOS package.**

Build apps/web before packaging, include the desktop bundle, DSH runtime dependencies, client-bundle assets, and preload output in the application resources. Exclude source maps, development fixtures, and unneeded platform binaries. Fail the packager when a declared client graph asset is missing.

- [ ] **Step 4: Add deterministic signing and notarization inputs.**

Use APPLE_DEVELOPER_ID_APPLICATION_P12, APPLE_DEVELOPER_ID_APPLICATION_P12_PASSWORD, APPLE_TEAM_ID, APPLE_NOTARY_KEY, APPLE_NOTARY_KEY_ID, and APPLE_NOTARY_ISSUER_ID in the desktop release workflow. The packaging command refuses release mode when any required identity is absent. Local unsigned development builds use a distinct development command and never claim notarization.

- [ ] **Step 5: Verify the final artifact.**

~~~bash
codesign --verify --deep --strict --verbose=2 "DSH.app"
spctl --assess --type execute --verbose=4 "DSH.app"
xcrun stapler validate "DSH.app"
~~~

Run the packaged app smoke test on an Apple-silicon macOS runner after notarization.

- [ ] **Step 6: Document the desktop service and decision record.**

Document runtime lifecycle, bridge wire operations, no-listener guarantee, persistent-state ownership, failure behavior, native command routing, build commands, and the model/token effect. The Agent Note records why Electron main hosts the runtime and why credentials stay behind DSH providers.

- [ ] **Step 7: Run the narrow release validation ladder.**

Run: pnpm run test:gui

Run: DSH_SNAPSHOT=replay pnpm run test:web

Run: pnpm --filter @deepseek-ai/dsh-desktop test:e2e

Run: pnpm run verify-doc-budgets

Run: pnpm run doc-sync

Expected: PASS, except signing and notarization commands when no release credentials are intentionally present; the release workflow owns those credentialed checks.

- [ ] **Step 8: Commit the distribution surface.**

~~~bash
git add apps/desktop package.json pnpm-lock.yaml .github/workflows/release-desktop.yml docs/subsystems/desktop-runtime.md .agents/notes/implemented/feature/2026-08-17-macos-desktop-gui.md
git commit -m "feat: package DSH Desktop for macOS"
~~~

## Plan Self-Review

Spec coverage: Tasks 1 through 5 implement file-backed client loading, in-process DSH runtime, no-listener transport, preload isolation, durable session reuse, Electron lifecycle, and assembled IPC verification. Tasks 6 through 8 implement the Mac workbench layout, navigation hierarchy, inspector behavior, native commands, execution context, permission scope presentation, and recoverable run states. Task 9 covers direct signed distribution, notarization, Gatekeeper, documentation, and macOS smoke verification.

Placeholder scan: Every task names created or modified files, concrete tests, commands, produced interfaces, and commit boundaries. The only external prerequisites are Apple release identities, which are named release-workflow secret inputs and deliberately block release mode rather than produce an unsigned release claim.

Type consistency: ClientBundleCatalog supplies the boot graph and authorized assets to Electron protocol.ts. DesktopBridge is consumed by DesktopApiClient and implemented by preload.ts plus runtime bridge.ts. DesktopRuntimeSupervisor provides runtime lifecycle to main.ts. Desktop presentation state travels through declared ui-desktop stores and ui-layout slots, not through Electron objects or session mutations.

## Execution Handoff

Plan complete and saved to docs/superpowers/plans/2026-08-17-macos-desktop-gui.md.

Two execution options:

1. Subagent-Driven (recommended) - Dispatch a fresh subagent per task, review between tasks, and retain the milestone gates.

2. Inline Execution - Execute tasks in this session using executing-plans, with checkpoints after each task.

Which approach?
