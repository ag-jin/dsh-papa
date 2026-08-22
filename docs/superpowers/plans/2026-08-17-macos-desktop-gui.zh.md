# macOS Desktop GUI 实施计划

[English](2026-08-17-macos-desktop-gui.md) | 中文

> **致 Agent 执行者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实施本计划。步骤使用复选框（- [ ]）语法跟踪。

**目标：** 构建一个使用 ad-hoc 签名但未公证、以 Mac 优先的 Electron 应用，在无网络监听器的情况下托管本地 DSH 运行时，并将现有插件组合客户端呈现为面向本地独立开发者的原生桌面工作台。

**架构：** Electron 主进程拥有应用级 DesktopRuntimeSupervisor、文件存储的客户端包目录、原生窗口以及所有特权 macOS 操作。上下文隔离的 preload 桥接层承载既有 API 请求-响应协议和两条下行流，交付给现有浏览器客户端组合内的桌面 API 客户端。桌面专属 UI 通过声明的客户端槽位贡献；它不 fork 会话、对话、权限或工具状态。

**技术栈：** TypeScript、Electron、React 18、Cordis、Vite 构建的客户端包、Vitest、Playwright 或 Electron 的测试运行器、Apple silicon 上的 macOS 14。

**规范：** docs/superpowers/specs/2026-08-17-macos-desktop-gui-design.md

## 全局约束

- 目标为运行 macOS 14 或更高版本的 Apple silicon 系统。
- 渲染进程和所有客户端插件包均从打包的本地资源加载；DSH Desktop 不拥有任何监听的 TCP 或 UDP 端口。
- 保持上下文隔离开启，禁用渲染进程 Node 集成，并且只暴露版本化、白名单化的 preload 桥接层。
- DSH 仍然是会话日志、Agent 设置、凭据引用、工作区记录、工具结果和后台任务的拥有者。
- Electron 用户数据只保存桌面窗口和视图偏好；它不包含凭据、会话记录副本和工具输出缓存。
- 保持浏览器 GUI 作为同一 DSH 服务与数据的一等受支持客户端。
- 通过现有客户端槽位、派生 props 和声明的 store 组合 UI。不要在功能组件中添加渲染进程 React contexts、全局 store 句柄或直接 Electron 调用。
- 产品文案使用中文；代码注释与 JSDoc 使用英文。
- 每次非平凡的产品可见变更都要更新包 README 文件、子系统文档、Agent Note 以及无密钥的组装 UI 快照。
- 在执行以下列出的提交命令之前，先从附带的 Git worktree 执行本计划。

---

## 文件结构

- 创建：packages/client/modules/src/catalog.ts - 从客户端行创建仅宿主使用的文件存储启动清单，并解析经授权的 bundle 资产。
- 修改：packages/client/modules/src/index.ts - 导出目录 provider，但不对其耦合 Web 服务器。
- 修改：packages/client/modules/src/client/manifest.ts - 将本地 bundle URL 记录为额外的合法模块源。
- 创建：packages/client/connection/src/client/desktop-bridge.ts - 声明渲染进程安全的 preload 桥接契约与 DshWindow 扩展。
- 创建：packages/client/connection/src/client/desktop-api-client.ts - 将桥接请求-响应和下行流适配到 AbstractApiClient。
- 修改：packages/client/connection/src/client/index.ts - 启动时选择 fixture、desktop 或 browser 传输层。
- 创建：packages/desktop/runtime/package.json - Electron 主进程运行时 provider 的包清单。
- 创建：packages/desktop/runtime/src/runtime.ts - 拥有桌面 Cordis 组合、API 分发和关闭状态机。
- 创建：packages/desktop/runtime/src/bridge.ts - 校验桥接调用，并拥有每窗口下行订阅。
- 创建：packages/desktop/runtime/src/index.ts - 导出运行时 provider 及其已文档化的服务接口。
- 创建：packages/bundle/desktop-app/cordis.patch.yml - 在不包含 webserver、frontend-static、web-runtime 或 HMR 行的情况下组合 DSH 服务与浏览器客户端行。
- 创建：packages/bundle/desktop-app/package.json - 声明桌面 bundle 及其组合使用的所有裸插件依赖。
- 创建：apps/desktop/package.json - 定义 Electron 构建、测试、开发与打包脚本。
- 创建：apps/desktop/src/main.ts - 启动运行时 supervisor、注册安全协议、创建并恢复窗口、协调关闭。
- 创建：apps/desktop/src/preload.ts - 通过 contextBridge 暴露桥接层，并在 IPC 转发前校验渲染进程 payload。
- 创建：apps/desktop/src/window-state.ts - 持久化仅桌面使用的窗口和面板状态。
- 创建：apps/desktop/src/menu.ts - 拥有原生 macOS 菜单，并将声明的桌面命令分发给活动渲染进程。
- 创建：apps/desktop/src/protocol.ts - 只解析目录授权范围内的客户端 bundle 文件和打包的渲染进程资产。
- 创建：apps/desktop/tests/desktop.e2e.ts - 通过 Electron 驱动 fixture 组合，并证明无监听器要求。
- 创建：planned/client/ui-desktop/package.json - 仅桌面使用的客户端插件包。
- 创建：planned/client/ui-desktop/src/client/DesktopChrome.tsx - 渲染工作台工具栏、运行状态和桌面命令绑定。
- 创建：planned/client/ui-desktop/src/client/ExecutionContextRow.tsx - 在 composer 主体之外呈现工作区、预设、模型、团队或专家以及权限范围。
- 创建：planned/client/ui-desktop/src/client/desktop-store.ts - 存储桌面本地的 inspector 可见性与运行上下文呈现状态。
- 修改：packages/client/ui-layout/src/client/AppFrame.tsx - 声明并渲染工具栏和 inspector 控制槽位，且不改变会话状态所有权。
- 修改：packages/client/ui-layout/src/client/stores.ts - 通过其声明的 store action API 接收恢复后的面板偏好。
- 修改：packages/client/ui-sidebar/src/client/SidebarRoot.tsx - 将工作区/会话导航与稳定插件目的地分离。
- 修改：packages/client/ui-conversation/src/client/skeleton/ConversationRoot.tsx - 在 composer 上方渲染执行上下文槽位，并移除桌面 oversized 空状态处理。
- 修改：packages/client/ui-conversation/src/client/contract/slots.ts - 声明执行上下文 owner props 与授权路径。
- 创建：docs/subsystems/desktop-runtime.md - 维护桌面运行时服务、IPC 和生命周期参考文档。
- 创建：.agents/notes/implemented/feature/2026-08-17-macos-desktop-gui.md - 实施后记录桌面传输层、特权和持久化决策。

## 里程碑 1：传输层与运行时基础

### 任务 1：提取文件存储的客户端 bundle 目录

**文件：**
- 创建：packages/client/modules/src/catalog.ts
- 修改：packages/client/modules/src/index.ts
- 修改：packages/client/modules/src/client/manifest.ts
- 测试：packages/client/modules/tests/catalog.client.spec.ts
- 测试：packages/client/modules/tests/load-path.client.spec.ts

**消费：** 现有 dsh.client manifest 行和当前 WebBootGraph wire 格式。

**产出：** ClientBundleCatalog，提供 createBootGraph() 和 resolveBundle(id, rev)，供 Electron 协议处理器与现有浏览器 modules 路由消费。

- [ ] **步骤 1：在提取宿主代码之前编写目录测试。**

~~~text
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

- [ ] **步骤 2：运行聚焦测试并确认缺少目录功能。**

运行：pnpm exec vitest run packages/client/modules/tests/catalog.client.spec.ts

预期：FAIL，因为 createClientBundleCatalog 尚未导出。

- [ ] **步骤 3：将目录实现为仅宿主使用的 provider。**

~~~text
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

将路径发现、realpath 包含校验和内容哈希校验保留在目录内部。Web 路由与 Electron 协议处理器只接收目录接口。

- [ ] **步骤 4：重构当前 modules 宿主路径，使其从 ClientBundleCatalog 构建注入的启动图。**

保留现有浏览器 URL 与 HMR 行为。不要在 packages/client/modules 中添加 Electron 导入。

- [ ] **步骤 5：运行模块测试与客户端构建检查。**

运行：pnpm exec vitest run packages/client/modules/tests/catalog.client.spec.ts packages/client/modules/tests/load-path.client.spec.ts

运行：pnpm exec tsc -p packages/client/modules/tsconfig.json --noEmit

预期：PASS。

- [ ] **步骤 6：提交提取结果。**

~~~bash
git add packages/client/modules
git commit -m "refactor: extract client bundle catalog"
~~~

### 任务 2：为客户端连接包添加桌面 API 传输层

**文件：**
- 创建：packages/client/connection/src/client/desktop-bridge.ts
- 创建：packages/client/connection/src/client/desktop-api-client.ts
- 修改：packages/client/connection/src/client/index.ts
- 测试：packages/client/connection/tests/desktop-api-client.client.spec.ts
- 测试：packages/client/connection/tests/connection.client.spec.ts

**消费：** AbstractApiClient、事件帧模式以及任务 1 中目录提供的本地客户端 bundle。

**产出：** DesktopApiClient 与全局 DesktopBridge 声明。现有连接插件仅在 preload 桥接层存在时选择 DesktopApiClient。

- [ ] **步骤 1：编写请求转发、下行排序、畸形事件拒绝和 abort 传播测试。**

~~~text
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

- [ ] **步骤 2：运行测试文件并确认桌面传输层尚不存在。**

运行：pnpm exec vitest run packages/client/connection/tests/desktop-api-client.client.spec.ts

预期：FAIL，因为 DesktopApiClient 和 DesktopBridge 不存在。

- [ ] **步骤 3：定义渲染进程安全的桥接契约。**

~~~text
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

这些值只包含 JSON 兼容的 wire 数据。不要把 Electron、Node、EventEmitter、文件路径或回调对象放到 window 上。

- [ ] **步骤 4：将 DesktopApiClient 实现为 AbstractApiClient 子类。**

将 doFetch 映射到 DesktopBridge.request。响应解析时复用现有 API 模式。使用与 WebApiClient 相同的 abort 清理行为构建 mux 与 host AsyncIterable 队列。为每个已接受的服务器请求调用 onEnvelope。

- [ ] **步骤 5：更新 connection apply 选择逻辑，而不削弱 fixture 行为。**

~~~text
const desktopBridge = window.__DSH_DESKTOP__
const api: IApiClient = fixtureClient ?? (desktopBridge === undefined ? new WebApiClient() : new DesktopApiClient(desktopBridge))
~~~

将 fixture 模式保持在前，以便 Web 测试 fixture 保持 hermetic。由于桌面桥接层的授权模型中不再有浏览器源参与，因此将 isLoopback 设为 true。

- [ ] **步骤 6：运行聚焦测试，然后运行 GUI 内部循环。**

运行：pnpm exec vitest run packages/client/connection/tests/desktop-api-client.client.spec.ts packages/client/connection/tests/connection.client.spec.ts

运行：pnpm run test:gui

预期：PASS。

- [ ] **步骤 7：提交客户端传输层。**

~~~bash
git add packages/client/connection
git commit -m "feat: add desktop client transport"
~~~

### 任务 3：实现主进程 DSH 运行时与 IPC 权限

**文件：**
- 创建：packages/desktop/runtime/package.json
- 创建：packages/desktop/runtime/src/runtime.ts
- 创建：packages/desktop/runtime/src/bridge.ts
- 创建：packages/desktop/runtime/src/index.ts
- 创建：packages/desktop/runtime/src/invariant.ts
- 创建：packages/desktop/runtime/tests/runtime.spec.ts
- 创建：packages/desktop/runtime/tests/bridge.spec.ts
- 创建：packages/bundle/desktop-app/package.json
- 创建：packages/bundle/desktop-app/cordis.patch.yml
- 创建：packages/bundle/desktop-app/README.md

**消费：** ApiProxy、toFetchHandler、ClientBundleCatalog 和 dsh-base bundle。

**产出：** 提供 start()、attachWindow()、detachWindow()、stop() 与状态快照的 DesktopRuntimeSupervisor。supervisor 在不挂载 dsh-host-webserver 的情况下提供桌面桥接分发。

- [ ] **步骤 1：编写运行时状态机测试。**

~~~text
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

- [ ] **步骤 2：运行测试并确认 supervisor 尚不存在。**

运行：pnpm exec vitest run packages/desktop/runtime/tests/runtime.spec.ts packages/desktop/runtime/tests/bridge.spec.ts

预期：FAIL，因为包与服务不存在。

- [ ] **步骤 3：实现显式运行时生命周期。**

~~~text
export type DesktopRuntimeState = 'starting' | 'ready' | 'degraded' | 'stopping' | 'stopped'

export interface DesktopRuntimeSupervisor {
  start(): Promise<void>
  attachWindow(windowId: string, publish: DesktopDownlinkPublisher): () => void
  request(windowId: string, request: DesktopRequest): Promise<DesktopResponse>
  snapshot(): DesktopRuntimeSnapshot
  stop(): Promise<void>
}
~~~

在 dsh-base 之上激活桌面 bundle。不要在 Cordis 包中导入 Electron。通过其文档化服务获取 ApiProxy，并且只在桥接适配器中调用 toFetchHandler。

- [ ] **步骤 4：实现桥接校验与每窗口下行流。**

在触碰 ApiProxy 之前校验操作名、请求信封模式、发送者窗口身份、流 kind 和退订所有权。为每个订阅提供 disposer。窗口 detach 时，先中止两条下行源并移除其处理器，再返回。

- [ ] **步骤 5：在排除 Web-only 行的情况下，从 Web 功能清单组合桌面 bundle。**

仅复制现有 UI 所需的主机服务与 dsh.client 行。排除 webserver、frontend-static、web-startup、web-runtime、client-hmr 以及任何假设 HTTP 来源的信任配置。添加新的桌面运行时行，并保留相同客户端功能行。

- [ ] **步骤 6：添加运行时不变式与 README。**

不变式证明，就绪的 DesktopRuntimeSupervisor 具有活动 ApiProxy 且没有 WebServer 服务。README 文档记录模型效果、桌面无监听器行为、生命周期失败状态和桥接权限边界。

- [ ] **步骤 7：运行包、bundle 与 GUI 测试。**

运行：pnpm exec vitest run packages/desktop/runtime/tests/runtime.spec.ts packages/desktop/runtime/tests/bridge.spec.ts

运行：pnpm run test:gui

预期：PASS。

- [ ] **步骤 8：提交桌面运行时边界。**

~~~bash
git add packages/desktop/runtime packages/bundle/desktop-app
git commit -m "feat: add desktop DSH runtime"
~~~

### 任务 4：构建 Electron 应用外壳与本地资源协议

**文件：**
- 创建：apps/desktop/package.json
- 创建：apps/desktop/src/main.ts
- 创建：apps/desktop/src/preload.ts
- 创建：apps/desktop/src/protocol.ts
- 创建：apps/desktop/src/window-state.ts
- 创建：apps/desktop/src/global.d.ts
- 创建：apps/desktop/tests/preload.spec.ts
- 创建：apps/desktop/tests/protocol.spec.ts
- 创建：apps/desktop/tests/window-state.spec.ts

**消费：** 任务 1 和 3 中的 DesktopRuntimeSupervisor 与 ClientBundleCatalog，以及 Vite 构建的 apps/web 渲染进程输出。

**产出：** 一个 macOS Electron 进程，从打包文件加载渲染进程、注入启动图、通过特权本地协议提供经授权的插件 bundle，并通过 preload 暴露版本化桥接层。

- [ ] **步骤 1：编写安全与协议测试。**

~~~text
it('registers only packaged renderer and active catalog files', async () => {
  const response = await protocol.fetch('dsh-client://bundle/%40deepseek-ai%2Fdsh-client-runtime?rev=abc')
  expect(await response.text()).toContain('__ModuleLoader__')
  await expect(protocol.fetch('dsh-client://bundle/etc/passwd?rev=abc')).rejects.toThrow('desktop bundle is not in the active client graph')
})

it('exposes no arbitrary ipc renderer API', () => {
  expect(exposedKeys(preloadWindow)).toEqual(['request', 'subscribe', 'sendCommand', 'getWindowState', 'setWindowState'])
})
~~~

- [ ] **步骤 2：运行测试并确认应用外壳尚不存在。**

运行：pnpm exec vitest run apps/desktop/tests/preload.spec.ts apps/desktop/tests/protocol.spec.ts apps/desktop/tests/window-state.spec.ts

预期：FAIL，因为 apps/desktop 不存在。

- [ ] **步骤 3：定义 Electron 包构建图。**

在 apps/desktop/package.json 中添加 Electron、Electron Forge、TypeScript 构建输出和测试命令。使该包依赖构建后的 apps/web 渲染进程、桌面 bundle 和桌面运行时。将每个需要生命周期脚本的依赖添加到 pnpm-workspace allowBuilds，然后再安装。

- [ ] **步骤 4：实现安全协议与窗口创建。**

在构造 BrowserWindow 之前注册本地 client-bundle 协议。只解析打包渲染进程根目录中的资产，以及来自 ClientBundleCatalog 的 bundle URL。创建 BrowserWindow，要求 contextIsolation 为 true、nodeIntegration 为 false、sandbox 为 true，提供 preload 路径，并配置只允许打包渲染进程和本地 client 协议的 Content Security Policy。

- [ ] **步骤 5：将 preload 实现为窄序列化器。**

使用 contextBridge.exposeInMainWorld 暴露 DesktopBridge 契约。序列化请求 payload，只调用固定 IPC 通道名，返回纯 JSON，并为每个事件订阅注册退订。绝不暴露 ipcRenderer、shell、dialog、process、require 或任意通道方法。

- [ ] **步骤 6：在运行 AppWebEntry 之前注入启动图。**

在 preload 或生成的渲染引导资产中，从 ClientBundleCatalog 生成 window.__DSH_BOOT__。插件 bundle 使用 dsh-client URL，以使现有 ClientModuleSystem 脚本加载路径无需 HTTP 服务即可生效。

- [ ] **步骤 7：添加仅桌面窗口状态持久化。**

在经校验的变更后持久化几何尺寸、活动工作区标识符、活动会话标识符、源列表可见性、inspector 可见性和面板宽度。创建窗口前，对照当前显示器工作区校验恢复后的边界。

- [ ] **步骤 8：运行应用测试并构建渲染进程与 Electron 主进程。**

运行：pnpm exec vitest run apps/desktop/tests/preload.spec.ts apps/desktop/tests/protocol.spec.ts apps/desktop/tests/window-state.spec.ts

运行：pnpm --filter @deepseek-ai/dsh-web-frontend run build

运行：pnpm --filter @deepseek-ai/dsh-desktop run build

预期：PASS。

- [ ] **步骤 9：提交安全应用外壳。**

~~~bash
git add apps/desktop pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "feat: add Electron desktop shell"
~~~

### 任务 5：端到端验证组装后的桌面传输层

**文件：**
- 创建：apps/desktop/tests/desktop.e2e.ts
- 创建：apps/desktop/tests/fixtures/desktop.cordis.yml
- 修改：apps/desktop/package.json
- 修改：package.json

**消费：** 任务 1 到 4 中的所有基础组件。

**产出：** 一条真实进程冒烟通道，验证渲染进程使用桌面桥接层、会话流式输出、工具执行在 fixture 数据下工作，且 DSH Desktop 不打开监听器。

- [ ] **步骤 1：创建失败的组装 Electron 场景。**

~~~text
it('boots a local session through IPC with no listening DSH port', async () => {
  const app = await launchDesktop({ fixture: 'desktop.cordis.yml' })
  await expect(app.window.getByRole('textbox')).toBeVisible()
  await app.window.getByRole('textbox').fill('create a file')
  await app.window.getByRole('button', { name: 'Send' }).click()
  await expect(app.window.getByText('tool result')).toBeVisible()
  expect(await listeningPortsOwnedBy(app.pid)).toEqual([])
})
~~~

- [ ] **步骤 2：运行场景并确认组装后的应用尚不能启动。**

运行：pnpm --filter @deepseek-ai/dsh-desktop test:e2e -- desktop.e2e.ts

预期：FAIL，因为 Electron 启动或桌面组合不可用。

- [ ] **步骤 3：构建启动打包主进程（而非 dsh web）的 fixture 辅助函数。**

辅助函数等待渲染进程就绪信号，并清理每个 Electron 子进程。它绝不启动 Vite 服务器，也绝不连接 3080 端口。

- [ ] **步骤 4：添加渲染进程重新加载、审批下发、桥接拒绝与干净关闭的场景。**

断言：渲染进程重新加载后重连到应用级运行时；审批出现在活动会话中；未声明的桥接通道失败；窗口关闭后持久化会话数据保持不变。

- [ ] **步骤 5：运行完整桌面基础通道。**

运行：pnpm --filter @deepseek-ai/dsh-desktop test:e2e

运行：pnpm run test:gui

预期：PASS。

- [ ] **步骤 6：提交基础验收测试。**

~~~bash
git add apps/desktop/tests apps/desktop/package.json package.json
git commit -m "test: cover desktop IPC boot"
~~~

## 里程碑 2：Mac 工作台体验

### 任务 6：添加桌面工具栏、原生命令桥接与恢复后的面板几何

**文件：**
- 创建：planned/client/ui-desktop/package.json
- 创建：planned/client/ui-desktop/src/client/index.ts
- 创建：planned/client/ui-desktop/src/client/DesktopChrome.tsx
- 创建：planned/client/ui-desktop/src/client/desktop-store.ts
- 创建：planned/client/ui-desktop/src/client/DesktopChrome.module.css
- 修改：packages/client/ui-layout/src/client/AppFrame.tsx
- 修改：packages/client/ui-layout/src/client/stores.ts
- 修改：apps/desktop/src/menu.ts
- 修改：apps/desktop/src/main.ts
- 测试：planned/client/ui-desktop/tests/desktop-chrome.client.spec.tsx
- 测试：planned/client/ui-layout/tests/layout.client.spec.tsx
- 测试：apps/desktop/tests/menu.spec.ts

**消费：** 任务 2 中的 DesktopBridge 和任务 4 中恢复的 DesktopWindowState。

**产出：** 带原生命令支撑的工具栏，具备源列表与 inspector 开关、活动运行状态、命令搜索，以及同步持久化的面板设置。

- [ ] **步骤 1：编写组件与菜单测试。**

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

- [ ] **步骤 2：运行聚焦测试并确认桌面 UI 包缺失。**

运行：pnpm exec vitest run planned/client/ui-desktop/tests/desktop-chrome.client.spec.tsx apps/desktop/tests/menu.spec.ts

预期：FAIL，因为 ui-desktop 与菜单分发器均不存在。

- [ ] **步骤 3：扩展布局槽位契约。**

将 shell.toolbar 与 shell.inspector-control 声明为现有根布局注册的子槽位。在 AppFrame 中通过派生槽位 props 渲染它们。源列表、对话和详情列的所有权保持不变。

- [ ] **步骤 4：创建桌面呈现 store。**

~~~text
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

在 ui-desktop apply 函数中创建其 handle，并且只通过声明的 PropsStore 共享传递。

- [ ] **步骤 5：实现原生菜单所有权。**

在 apps/desktop/src/menu.ts 中创建 File、Edit、View、Session、Window 菜单模板。标准编辑命令使用 Electron roles。DSH 专属项向聚焦的渲染进程发送固定 DesktopCommand 值。没有聚焦的就绪窗口时禁用命令。

- [ ] **步骤 6：通过类型化桥接状态恢复布局偏好。**

桌面插件激活时，读取一次 DesktopWindowState 并注入 store actions。在状态转换后（而非渲染期间）持久化变更。现有浏览器会话由于缺少桌面桥接层而保留瞬时几何设置。

- [ ] **步骤 7：运行聚焦测试与 GUI 内部循环。**

运行：pnpm exec vitest run planned/client/ui-desktop/tests/desktop-chrome.client.spec.tsx planned/client/ui-layout/tests/layout.client.spec.tsx apps/desktop/tests/menu.spec.ts

运行：pnpm run test:gui

预期：PASS。

- [ ] **步骤 8：提交工具栏与原生命令支持。**

~~~bash
git add packages/client/ui-desktop packages/client/ui-layout apps/desktop
git commit -m "feat: add desktop workbench chrome"
~~~

### 任务 7：优化源列表顺序与面向本地开发的上下文 inspector

**文件：**
- 修改：packages/client/ui-sidebar/src/client/SidebarRoot.tsx
- 修改：packages/client/ui-sidebar/src/client/SidebarRoot.module.css
- 修改：packages/client/ui-conversation/src/client/skeleton/DetailsPanel.tsx
- 修改：packages/client/ui-layout/src/client/AppFrame.tsx
- 测试：packages/client/ui-sidebar/tests/sidebar-root.client.spec.tsx
- 测试：planned/client/ui-conversation/tests/details-panel.client.spec.tsx
- 测试：apps/web/tests/navigation-panes.e2e.ts

**消费：** 现有工作区与会话 hooks，以及可用时来自任务 6 的桌面面板状态。

**产出：** 两级源列表，其中工作区与会话导航保持主级，插件目的地占据独立的次级分组。右侧面板充当可隐藏的上下文 inspector。

- [ ] **步骤 1：添加失败的侧边栏层级与键盘标签测试。**

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

- [ ] **步骤 2：运行测试并确认新导航区域尚不存在。**

运行：pnpm exec vitest run packages/client/ui-sidebar/tests/sidebar-root.client.spec.tsx

预期：FAIL，因为源列表没有独立导航分组。

- [ ] **步骤 3：添加声明的侧边栏扩展座位。**

将工作区与会话行保留在现有侧边栏域中。添加命名次级目的地槽位，而不是将插件 UI 包导入 ui-sidebar。通过 owner props 只提供纯 id、选择状态与命令回调。

- [ ] **步骤 4：将 details 改为上下文 inspector。**

保留现有 Files、Changes 与插件详情贡献。添加 inspector 标签页头，其活动标签页由所选对话项或明确的用户选择推导。隐藏的 inspector 不渲染可见宽度，并在重新打开时恢复其最后有效的桌面宽度。

- [ ] **步骤 5：移除桌面尺寸空状态处理。**

保持空对话可用，但在桌面模式下将 hero 呈现缩减为紧凑的工作区/会话提示。浏览器 fallback 在其自身产品决策改变前保留现有行为。

- [ ] **步骤 6：运行组件、GUI 与组装视觉测试。**

运行：pnpm exec vitest run packages/client/ui-sidebar/tests/sidebar-root.client.spec.tsx planned/client/ui-conversation/tests/details-panel.client.spec.tsx

运行：pnpm run test:gui

运行：DSH_SNAPSHOT=replay pnpm run test:web

预期：PASS。只更新捕获有意且桌面中立的布局变更的预期快照。

- [ ] **步骤 7：提交源列表与 inspector 行为。**

~~~bash
git add packages/client/ui-sidebar packages/client/ui-conversation packages/client/ui-layout apps/web/tests
git commit -m "feat: organize desktop workspace navigation"
~~~

### 任务 8：整合执行上下文与运行状态恢复

**文件：**
- 创建：planned/client/ui-desktop/src/client/ExecutionContextRow.tsx
- 创建：planned/client/ui-desktop/src/client/RunStateControl.tsx
- 修改：packages/client/ui-conversation/src/client/contract/slots.ts
- 修改：packages/client/ui-conversation/src/client/skeleton/ConversationRoot.tsx
- 修改：packages/client/ui-conversation/src/client/skeleton/InputBar.tsx
- 修改：packages/client/ui-permission-presets/src/client/PermissionRow.tsx
- 修改：packages/client/ui-model-selection/src/client/ModelSelect.tsx
- 测试：planned/client/ui-desktop/tests/execution-context.client.spec.tsx
- 测试：planned/client/ui-conversation/tests/conversation-root.client.spec.tsx
- 测试：apps/desktop/tests/recovery.e2e.ts

**消费：** 现有预设、模型、权限、工作区、专家与会话服务。它不添加并行持久化模型。

**产出：** 一个紧凑的执行上下文界面，说明每次所选选项的 next-run、session、workspace 或 profile 范围，并显示可见运行状态与恢复操作。

- [ ] **步骤 1：编写失败的范围与风险测试。**

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

- [ ] **步骤 2：运行聚焦测试并确认上下文行尚不存在。**

运行：pnpm exec vitest run planned/client/ui-desktop/tests/execution-context.client.spec.tsx planned/client/ui-conversation/tests/conversation-root.client.spec.tsx

预期：FAIL，因为执行上下文槽位与组件不存在。

- [ ] **步骤 3：声明 conversation.execution-context 槽位。**

暴露可选的 session owner prop，携带会话 id、活动工作区 id、composer 阶段、待处理交互与当前运行状态。在 conversation.composer 上方渲染此槽位。不要通过 owner props 传递 React nodes。

- [ ] **步骤 4：将呈现控制移入桌面贡献。**

保持当前模型与权限服务为权威来源。其 UI 贡献者通过现有槽位或注入面，向 ExecutionContextRow 提供纯选中数据与变更回调。InputBar 只保留附件、草稿输入、发送与停止。

- [ ] **步骤 5：将持久生命周期事实映射到一个可见运行状态。**

显示 running、waiting for approval、waiting for user、completed、failed、cancelled 与 interrupted。只有在底层会话生命周期确定完成之后，completed 状态才会出现。Interrupted 只在运行时提供这些操作时暴露 Inspect 与 Resume。

- [ ] **步骤 6：添加恢复集成场景。**

启动 fixture 运行、重新加载渲染进程、重启运行时 supervisor，并强制关闭未完成运行。断言重连会显示投影历史，运行不会显示为 completed，并且会提供有效的下一步操作。

- [ ] **步骤 7：运行聚焦与组装测试。**

运行：pnpm exec vitest run planned/client/ui-desktop/tests/execution-context.client.spec.tsx planned/client/ui-conversation/tests/conversation-root.client.spec.tsx

运行：pnpm --filter @deepseek-ai/dsh-desktop test:e2e -- recovery.e2e.ts

运行：pnpm run test:gui

预期：PASS。

- [ ] **步骤 8：提交执行上下文与恢复 UI。**

~~~bash
git add packages/client/ui-desktop packages/client/ui-conversation packages/client/ui-permission-presets packages/client/ui-model-selection apps/desktop/tests
git commit -m "feat: clarify desktop execution context"
~~~

## 里程碑 3：分发与文档

### 任务 9：添加 macOS 打包与制品冒烟覆盖

**文件：**
- 修改：apps/desktop/package.json
- 创建：apps/desktop/forge.config.cjs
- 创建：apps/desktop/scripts/stage-mac.mjs
- 创建：apps/desktop/scripts/package-mac.mjs
- 创建：apps/desktop/scripts/make-dmg.mjs
- 修改：package.json
- 创建：.github/workflows/desktop-macos.yml
- 修改：apps/desktop/README.md
- 创建：.agents/notes/implemented/architecture/2026-08-17-desktop-runtime-no-listener.md

**消费：** 任务 1 到 8 中通过验证的组装 Electron 应用。

**产出：** 使用 ad-hoc 签名、不含 Developer ID 签名且未公证的 Apple Silicon macOS 应用和压缩磁盘映像，并由包结构验证覆盖。

- [ ] **步骤 1：编写失败的包闭包测试。**

~~~text
it('requires the packaged application resources and unpacked runtime closure', () => {
  expect(applicationResources).toContain('app.asar')
  expect(applicationResources).toContain('app.asar.unpacked/node_modules')
  expect(applicationResources).toContain('config/cordis.yml')
  expect(applicationResources).toContain('renderer/index.html')
})
~~~

- [ ] **步骤 2：运行聚焦应用测试并确认打包支持尚不存在。**

运行：pnpm --filter @deepseek-ai/dsh-desktop test

预期：FAIL，因为包闭包和打包资源定位器尚不存在。

- [ ] **步骤 3：配置 macOS 14+ arm64 包。**

在 staging 前构建宿主库、客户端库、apps/web 和 Electron 主进程。staging 渲染器、配置、preset 根、桌面 bundle、preload 输出和已物化的生产运行时闭包。排除 source map，并在必需资源或 staging symbolic link 仍存在时失败。

- [ ] **步骤 4：构建未公证的应用与磁盘映像。**

使用 ad-hoc Electron 签名，不配置 Developer ID identity、Apple 凭据、公证或 GitHub Release。通过 Electron Forge 创建 `DSH.app`，并使用 `hdiutil` 创建压缩 DMG。

- [ ] **步骤 5：验证最终制品。**

~~~bash
codesign --verify --deep --strict "DSH.app"
hdiutil verify "DSH-<version>-arm64.dmg"
~~~

在 macOS 14 Apple Silicon runner 上运行打包应用冒烟和结构检查。

- [ ] **步骤 6：记录桌面服务与决策记录。**

记录运行时生命周期、桥接 wire 操作、无监听器保证、持久化状态所有权、失败行为、原生命令路由、构建命令、ad-hoc 签名限制和模型/令牌效果。Agent Note 记录为什么 Electron 主进程托管运行时，以及为什么凭据仍保留在 DSH providers 之后。

- [ ] **步骤 7：运行窄分发验证阶梯。**

运行：pnpm --filter @deepseek-ai/dsh-desktop test

运行：pnpm run constraints

运行：pnpm run doc-sync

预期：PASS。GitHub Actions workflow 会将应用和磁盘映像作为 artifact 上传，不使用 Apple 凭据，也不创建 GitHub Release。

- [ ] **步骤 8：提交分发表面。**

~~~bash
git add apps/desktop package.json pnpm-lock.yaml .github/workflows/desktop-macos.yml .agents/notes/implemented/architecture/2026-08-17-desktop-runtime-no-listener.md
git commit -m "feat: package DSH Desktop for macOS"
~~~

## 计划自审

规范覆盖：任务 1 到 5 实现文件存储客户端加载、进程内 DSH 运行时、无监听器传输层、preload 隔离、持久会话复用、Electron 生命周期与组装 IPC 验证。任务 6 到 8 实现 Mac 工作台布局、导航层级、inspector 行为、原生命令、执行上下文、权限范围呈现与可恢复运行状态。任务 9 覆盖 ad-hoc 应用和磁盘映像打包、Actions artifact、文档和 macOS 冒烟验证。

占位符扫描：每个任务都列出创建或修改的文件、具体测试、命令、产出接口与提交边界。唯一外部前置条件是 Apple Silicon macOS 14 runner；打包不需要 Apple identity、公证输入或发布凭据。

类型一致性：ClientBundleCatalog 为 Electron protocol.ts 提供启动图与授权资产。DesktopBridge 由 DesktopApiClient 消费，并由 preload.ts 加运行时 bridge.ts 实现。DesktopRuntimeSupervisor 为 main.ts 提供运行时生命周期。桌面呈现状态通过声明的 ui-desktop stores 与 ui-layout slots 传递，不通过 Electron 对象或会话变更传递。

## 执行交接

计划已完成，并保存到 docs/superpowers/plans/2026-08-17-macos-desktop-gui.md。

两种执行选项：

1. 子 Agent 驱动（推荐） - 为每个任务分派全新子 agent，在任务之间进行审查，并保留里程碑门禁。

2. 内联执行 - 在当前会话中使用 executing-plans 执行任务，并在每个任务之后设置检查点。

采用哪种方式？
