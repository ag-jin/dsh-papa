# Agent Note: Desktop runtime owns embedded transport without a listener

Status: implemented

[English](2026-08-17-desktop-runtime-no-listener.md) | 中文

## Problem

浏览器应用通过 Web 服务器和浏览器 Origin 假设访问 DSH。macOS 桌面应用需要相同的 API 与客户端功能图，但不能绑定 DSH TCP 或 UDP 监听器，也不能授予渲染器宿主能力。

## Decision

`@deepseek-ai/dsh-desktop-runtime` 在组合出的 `ApiProxy` 之上拥有应用级 `DesktopRuntimeSupervisor`。它通过 `toFetchHandler(api)` 分发一元请求，通过 `api.respond()` 返回客户端响应回执，并把固定的 `mux` 和 `host` 事件源转发为完整 `ServerRequest` 信封。每个附加的渲染器窗口拥有两个事件源和所有活动一元请求的 abort controller；替换和分离会终止这些所有权，而运行时停止还会等待每个活动一元 dispatch 与每个 pump 完成结算（无论成功或拒绝），或等到配置的关闭截止时间后才报告 `stopped`。

`@deepseek-ai/dsh-desktop-app` 通过补丁组合扩展基础应用。它包含客户端功能条目、API proxy、模块注册表、连接包和桌面运行时，但排除浏览器服务器、静态资源、启动、运行时、HMR 和 HTTP Origin 信任条目。因此，`ClientModuleRegistry` 与 connection core 都将 `webServer` 视为可选服务：catalog 和启动图组合仍可供桌面协议处理器使用，而浏览器路由、index 注入、`/api` 和 WebSocket 下行流只在组合该服务时存在。桌面补丁直接选择 native directory-picker provider，而非依赖 bind host 的 auto selector；它注册拒绝 `webServer` 的 bundle-level invariant，并以每个桌面会话的 `standard` agent preset 取代基础模型可见条目。

`apps/desktop` 在 app-boot preparation 中安装 `InvariantRegistry`，通过 `createRequire(package.json)` 将 bare base 和 desktop patch entry name 解析为 absolute module，随后在空的打包根配置之上启动这些 patch file，并把随包提供的 `standard` preset directory 加入为 system root。它在 application root 声明 base 和 desktop patch dependency union 以及 direct bootstrap provider，使此解析能在 Loader 导入 entry 前完成。它的 Electron 进程会在 ready 前注册 privileged `dsh-app` 和 `dsh-client` scheme，只在 realpath containment check 通过后提供 renderer file，将 active catalog boot graph 注入 renderer HTML，并只通过 `ClientBundleCatalog` 解析 bundle asset。主进程为每个窗口提供 sandboxed、context-isolated renderer，并禁用 Node integration 和单个打包后的 CommonJS preload bridge。response CSP 保持 `connect-src 'none'`，同时允许注入的本地 bootstrap script、已授权客户端 bundle、Loader expression evaluation 和打包的 data font。它的五个 IPC handler 将 Electron sender id 绑定给 `DesktopBridgeAuthority`；Electron-local state 只包含有界的 desktop view preference 和 window geometry，部分 renderer update 会与当前归一化状态合并。ad-hoc hardened-runtime 签名会向主进程和非 Plugin Helper app bundle 授予 JIT 及 library-validation 例外；Plugin Helper 则获得其所需的 executable-memory 与 library-validation 例外。

## Alternatives considered

**复用浏览器 Web 服务器。** 这会保留现有资源 URL，但会把桌面启动变为本地网络服务，保留 Origin 信任规则，并留下另一个需要保护和测试的监听器生命周期。

**暴露通用 Electron IPC 或文件系统调用。** 这会让渲染器集成更容易添加，但会给予不受信任的渲染器环境主进程权限。运行时只接受类型化 RPC 信封、固定下行流类别、固定取消 id 和窗口绑定操作。

**为桌面复制客户端模块图。** 这会在浏览器与桌面之间分裂 bundle revision 和路径校验。共享 catalog 仍是活动客户端 bundle 的唯一权威。

## Consequences

桌面调用方在没有 DSH 监听器的情况下使用与浏览器调用方相同的 API 请求和流语义。Electron 主进程拥有打包资源交付、每窗口 bridge attach、response CSP 和 desktop-local view state，浏览器专用服务仍位于桌面补丁之外。

## Verification

运行时包验证一元分发、回执、取消、格式错误的 bridge 输入、按窗口的流终止、运行时 invariant、真实 Cordis 插件挂载与释放、包 invariant 和桌面补丁解析器闭包。桌面应用验证 protocol containment 和 catalog authorization、boot-manifest injection、preload allowlisting、window security option 和 CSP、固定 IPC registration、listener-free patch boot、归一化的 desktop-local state、每种 Helper 的 entitlement 选择，以及通过打包 renderer、bridge、runtime request 和 standard-preset session 创建的真实 ad-hoc 签名应用。
