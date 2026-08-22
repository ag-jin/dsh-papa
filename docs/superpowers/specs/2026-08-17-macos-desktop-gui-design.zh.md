# DSH Desktop GUI Design

[English](2026-08-17-macos-desktop-gui-design.md) | 中文

## 目标

交付一个面向 Mac、可安装的 DSH 桌面应用，服务本地独立开发者。

应用提供原生窗口、菜单、键盘访问、生命周期管理、通知、文件对话框和工作区恢复，同时保留现有 Cordis 运行时与由插件组合的 React 客户端。

浏览器 GUI 仍然是跨平台界面。桌面应用不得另行实现 session、agent 执行、tool 或 conversation 渲染。

## 产品决策

DSH Desktop 将原生 `darwin-arm64` 和 `darwin-x64` build 作为 ad-hoc 签名应用与压缩磁盘映像分发，并提供未签名的 `win32-x64` 便携 ZIP。每个 target 都在匹配的 runner 上构建 native-module closure。移动客户端、Mac App Store 分发、自动更新、跨设备同步、自定义主题、Windows 代码签名和 Windows 安装器不在此版本范围内。

macOS build 没有 Developer ID 签名，也未公证。Mac App Store sandbox 与 DSH 在用户明确控制的权限下提供的广泛本地文件系统和 shell 访问不兼容。Windows ZIP 需要解压到可写的本地目录；由于未签名，可能触发 SmartScreen。

工作区是主窗口的主要身份。Session 属于工作区。开发者可以打开多个工作区窗口；应用重新启动后会恢复工作区、选中的 session、sidebar 状态、inspector 状态和 panel 宽度。

首个版本优化本地开发循环：打开工作区，创建或恢复 session，配置运行，执行工作，检查文件和变更，批准或停止操作，并恢复中断的工作。Team、SSH、task-board 和其他插件能力仍作为明确目的地或上下文 inspector view 提供，不定义默认导航。

## 架构

新的 apps/desktop Electron application 负责 macOS application lifecycle，并通过特权 `dsh-app://renderer/` scheme 加载打包后的 renderer；经授权的 client bundle 通过 `dsh-client://bundle/` 加载。

Electron main process 拥有单一 application-level DesktopRuntimeSupervisor。它激活 desktop Cordis composition，保留 DSH 的 session persistence、agent loop、API dispatcher 和启用的 tools，但省略 HTTP web server 与 frontend static server。桌面 composition 永远不暴露 application LAN listener。

Main process 负责 native menus、窗口创建与恢复、文件和目录对话框、Finder actions、notifications、shutdown coordination 和 runtime diagnostics。它是唯一拥有 Node 与 Electron privileges 的 desktop layer。

context-isolated preload script 暴露一个小型、带版本的 bridge。它为既有 API envelope protocol 提供一个 request-response operation，并提供对应既有 session 与 host event streams 的两个 downlink subscriptions。Bridge 只传递 data、cancellation 和 lifecycle signals，不向 renderer 提供任意 IPC、文件系统路径、shell execution 或 Electron module access。

Renderer 为既有 API-client transport abstraction 增加 desktop implementation。它把 preload request-response operation 和 downlinks 适配到浏览器 UI 使用的同一个 client connection service。Session projection、streaming accumulation、conversation nodes、UI slots、tool views 和 feature plugins 在该 transport 之上保持不变。

首个版本的 desktop runtime 位于 Electron main process。它保持 application-scoped 而非 window-scoped，因此 renderer reload 或某个窗口关闭不会终止另一个窗口的 active run。将其移到 child process 是后续架构选择，需要单独的 lifecycle 和 authentication design。

## 请求与事件流

Renderer action 通过 desktop API client 创建既有 client RPC request。

Preload bridge 将可序列化 request 转发给 Electron main process。

Main process 将 request dispatch 到 DSH 的 in-process API handler，并通过 preload bridge 返回序列化 response。

DSH session 与 host events 沿相反方向经过 main-process subscriptions、preload bridge、desktop API client、connection service 和现有 session manager。Renderer 只根据这些 events 与既有 session projections 重建可见状态。

每个窗口拥有自己的 connection generation。Disconnect 会清除该窗口的 live assumptions，保留已经 projection 的历史，并要求新的 host description 加上两条 event streams 后，窗口才再次报告 ready。

## 状态与持久化

DSH 仍然拥有 agent configuration、credential references、session logs、workspace records、tool results、background jobs 和 durable run facts。桌面应用必须复用已配置的 DSH home，使 CLI、browser surface 和 desktop surface 能访问同一份用户拥有的 settings 与 sessions。

Electron user-data storage 只保存 desktop-local state：window geometry、window-to-workspace restoration、selected session、expanded navigation groups、panel visibility、panel widths 和 notification preferences。Desktop-owned state 不包括 DSH credentials、session transcript copies 或 tool output caches。

Desktop credential storage 不向 renderer 暴露。首个版本继续使用已配置的 DSH credentials provider。未来的 Keychain integration 属于 credentials-provider implementation，因此可以保留既有 credential references，避免 renderer-specific secrets API。

Active run 只有一个可见状态：running、waiting for approval、waiting for user、completed、failed 或 cancelled。下一步可能的 action 与状态一起可见。Crash 或 forced exit 不得伪造成功完成；未结算的 run 以 interrupted 恢复，只能通过 DSH 的真实 lifecycle data 检查或恢复。

## Mac 工作台体验

窗口使用可隐藏的 source list、primary conversation area 和可隐藏的 contextual inspector。

Source list 对 workspaces 及其 sessions 分组。SSH 或 task board 等稳定 plugin destinations 位于明确的 secondary section，不与 workspace 和 session navigation 竞争。

Conversation area 包含 execution timeline 和 focused composer。Composer 接受 input、attachments 以及 send 或 stop actions。Preset 或 mode、model、expert 或 team selection、permission 和 workspace scope 出现在一个紧凑的 execution-context row 或 inspector 中。每个 setting 都说明它适用于 next run、current session、workspace 还是 user profile。

Inspector 展示 Files、Changes、tool output、activity，以及适用的 expert 或 team information。它跟随选中的 conversation item，可通过 command 显示或隐藏，支持持久化宽度，默认保持为 conversation 的次要区域。

Toolbar 只包含高频 actions：toggle source list、workspace 或 session title、run state、command search、inspector toggle 和一个明确的 primary action。Native menu bar 包含完整 command set，包括 workspace 与 session actions、navigation commands、stop 或 cancel，以及标准 edit actions。

Keyboard access 遵循 macOS conventions 与 Full Keyboard Access。应用快捷键只对高频 DSH commands 使用 Cmd family。Command palette 补充 menus，不能取代 menus。

界面遵循系统 light 或 dark appearance、accessibility text sizing、contrast settings、reduced motion 和 VoiceOver。它使用 system typography 与 semantic theme tokens。Translucency 仅用于 window chrome；conversation、code、diffs 和 tool output 保持高对比度工作表面。

当 DSH 不在前台时，notifications 只报告已完成、失败或需要 approval 的 runs。它们绝不暴露 model output、prompts、tool arguments、credentials 或 file contents。

## 插件集成

Browser-side feature plugins 继续通过现有 client slot system 组合 UI。Desktop-aware feature 可以通过声明的 integration points 提供 destination、command 或 inspector view；不能创建自己的 window chrome、unrestricted Electron bridge 或 persistent renderer singleton。

Desktop shell 从 declared commands 筛选 menu 和 toolbar commands。Plugin menu contribution 带有 stable command identity、visible label、enabled condition 和 invocation callback。Main process 负责放入 native macOS menus，并拒绝未识别的 bridge operations。

现有 plugin surfaces 保持兼容。Browser GUI 继续渲染它们而不增加 desktop-only behavior；desktop-specific enhancements 通过 capability check 判断，不能假定 user-agent detection。

## 安全与恢复

BrowserWindow 使用 context isolation、no Node integration、sandboxed renderer settings 和 restrictive Content Security Policy。Preload script 是唯一的 renderer-to-main path。

Electron main process 在 dispatch 到 DSH 前验证 bridge operation names、request fields、sender window identity、cancellation ownership 和 event subscription kinds。当 API 可以使用现有 capability references 时，它不接受 renderer 提供的 privileged host action file paths。

DSH permission policy 仍然权威地控制 shell execution、filesystem access 和 tool approval。用户批准 escalation 前，desktop UI 说明目标 workspace、selected permission level、scope 和 expected persistence。Desktop shell 不能扩大 DSH permission decision。

Startup failures 显示带 redacted error summary 的 diagnostics screen，并提供 Retry、Open Local Logs 和 Quit。Renderer failures 只重启 renderer 并重新连接到现有 runtime。Runtime failures 将每个窗口转为可恢复的 unavailable state；supervisor 可在记录 failure 并使 stale event subscriptions 失效后重启 runtime。

Application shutdown 先拒绝新工作，记录 window state，要求 runtime 在有界时间内结算 durable state，然后关闭窗口并 dispose runtime。Forced quit 会中断 active work，但绝不能将 interrupted operation 报告为 complete。

## 验证

Unit coverage 验证 runtime supervisor lifecycle、startup failure handling、bounded shutdown、window restoration、native-menu command dispatch、preload request mapping、event ordering、cancellation，以及对未识别 IPC channels 的拒绝。

Client coverage 继续通过 pnpm run test:gui。它包括 desktop connection status、execution-context scope labels、run-state actions、inspector visibility、restored layout state、approval presentation 和 no-access fallback behavior。

Desktop integration tests 针对 fixture DSH composition 启动 Electron application。它们创建并恢复 session，执行 streaming events，运行受控 tool，打开 Files 和 Changes inspector，传递 approval request，停止 run，模拟 renderer reload，并验证没有打开 LAN socket。

Native-runner smoke coverage 启动从最终 delivery artifact materialize 的每个 application，再检查 startup、bridge access、embedded session request 和 listener absence。macOS coverage 验证 ad-hoc signature 与从挂载 disk image 得到的 application；Windows coverage 验证未签名的便携 ZIP 与其解压后的 application。

## 验收标准

本地开发者可以安装并启动应用，而无需手动启动 dsh web。

应用可以打开 workspace、创建或恢复 session、在既有 permission policy 下运行 DSH tools，并在 primary conversation view 中显示 streaming output。

没有任何 listening TCP 或 UDP port 由 DSH Desktop 拥有。

关闭一个窗口不会终止另一个窗口中的 active work。重新启动后恢复窗口，并保留 durable DSH sessions，不将 transcript data 复制到 Electron storage。

Renderer process 没有 Node access，不能调用未声明的 native 或 DSH operation。

Browser GUI 仍然是同一 DSH runtime 和 session data 的受支持跨平台 client。
