# `@deepseek-ai/dsh-desktop`

[English](README.md) | 中文

此原生 Electron 启动器为本地开发者托管 DSH 桌面组合，并且不启动 DSH TCP 或 UDP 监听器。

## 运行时

进程入口会在 Loader entry mount 前安装 `InvariantRegistry`，通过 `createRequire(package.json)` 将 base 与 `dsh-desktop-app` patch entry 的 bare name 解析为 absolute module，随后在打包的空根配置之上启动这些层，将此包拥有的 `standard` agent-preset 根作为系统根加入，并启动 `DesktopRuntimeSupervisor`。

此 package 在 application root 声明 base 与 desktop patch dependency union、direct bootstrap provider，以及其随包 agent preset 引用的每个 package。staging 会递归物化这些 package 的 production dependency 与 required peer，因此 Loader 和 preset roster 都能从打包运行时解析每个配置 entry。

应用只通过 `dsh-app://renderer/...` 提供打包渲染器，只通过 `dsh-client://bundle/<id>?rev=<rev>` 提供 active catalog bundle。

协议处理器会对每个渲染器路径执行 realpath、拒绝 containment escape，并只通过 `ClientBundleCatalog` 解析客户端 bundle。

## 渲染器权限

每个 BrowserWindow 都启用 context isolation、sandboxed renderer、禁用 Node integration、启用 web security，并通过响应 Content Security Policy 禁止所有网络连接。该策略只允许本地 bootstrap script、catalog 已授权的客户端 bundle 与打包的 font data。

preload 是一个打包后的 CommonJS sandbox script，它暴露带有固定 JSON-only `request`、`cancel`、`subscribe`、`sendCommand`、`getWindowState` 和 `setWindowState` 操作的 `window.__DSH_DESKTOP__`。

Electron 主进程只注册五个渲染器到主进程 handler：request、cancel、command、window-state read 和 window-state write；每个 handler 都会先验证已附加 sender window identity。状态读取会返回归一化后的 bounds、panel visibility 和 width，以及 active workspace/session identifier；状态写入接受部分更新，并保留其他仅桌面使用的值。

## 桌面状态

Electron user data 只保存归一化后的窗口 bounds、panel visibility 和 width，以及 active workspace/session identifier。

DSH 仍然拥有 credentials、transcript、session、tool result、setting 和 background job。

## 开发

运行 `pnpm --filter @deepseek-ai/dsh-desktop run build`，以已构建的 workspace package declaration 编译 Electron main entry，并打包与 sandbox 兼容的 CommonJS preload。

运行 `pnpm --filter @deepseek-ai/dsh-desktop test`，执行 Electron protocol、preload、boot 和 state 的聚焦单元测试。

在构建 runtime、renderer 和 desktop entry 后，运行 `node node_modules/vitest/vitest.mjs run --config vitest.e2e.config.ts apps/desktop/tests/assembled-transport.e2e.ts`，验证装配后的 Electron bridge。

在原生 make command 后运行 `pnpm run desktop:materialize:delivery`，再将其 executable path 传给 `node node_modules/vitest/vitest.mjs run --config vitest.e2e.config.ts apps/desktop/tests/packaged-app-smoke.e2e.ts`。这会启动从最终 DMG 或 ZIP materialize 的应用，并验证已打包的 renderer、固定的 preload bridge 与嵌入式 session request。该 smoke test 仅为测试附着临时开启 loopback Chromium CDP endpoint；DSH runtime 仍不监听端口。

可运行的打包窗口还需要仓库中 `apps/web/dist` 下的渲染器 build output。

## 原生打包

每个 package command 接受 `DSH_DESKTOP_PLATFORM` 和 `DSH_DESKTOP_ARCH`，拒绝 cross-host target，并在对应 runner 上构建 production native-module closure。支持的 target 是 `darwin-arm64`、`darwin-x64` 和 `win32-x64`。

运行 `pnpm run desktop:package` 会生成本机 target 的 application directory。在 macOS 上运行 `pnpm run desktop:make:mac` 会创建 `apps/desktop/out/DSH-<version>-<arch>.dmg`；在 Windows 上运行 `pnpm run desktop:make:win` 会创建 `apps/desktop/out/make/zip/win32/x64/DSH-win32-x64-<version>.zip`。

macOS 包含 `DSH.app` 并使用 Electron 的 ad-hoc 签名，没有 Developer ID 签名，也未公证。因此在其他 Mac 上，可能需要按住 Control 点击应用或磁盘映像，然后选择“打开”。hardened-runtime 签名会向 Electron 主进程及其 Helper app bundle 授予加载内置 Electron Framework 所需的 entitlement；Plugin Helper 还会保留其 executable-memory entitlement。创建磁盘映像时，仅会重试 macOS 的瞬时 `hdiutil: create failed - Resource busy` 结果；其他 `hdiutil` 失败会立即停止。

Windows 包是未签名的便携 ZIP。请解压到可写的本地目录后运行 `DSH.exe`；由于该包没有代码签名证书，Windows 可能显示 SmartScreen 警告。

`Build desktop applications` GitHub Actions workflow 会在每个 target 的原生 runner 上构建，materialize 最终 DMG 或 ZIP，针对该 materialized application 运行 assembled 与 packaged Electron test，验证 platform artifact，并将它作为 14 天的 Actions artifact 保留。它只拥有只读 repository access，且不会创建 GitHub Release。

手动运行的 `Promote desktop release assets` workflow 可以将三份保留的最终 delivery file 复制到既有 GitHub Release。它接受明确的成功 desktop workflow run ID 与 Release tag，要求 source run workflow、source commit、target Release commit、artifact ID 和 delivery filename 全部匹配，再使用 runner 提供的 `GITHUB_TOKEN` 上传。它不构建 package、不创建 Release、不使用 Apple 或 Windows 签名凭据，也不配置 update service。

## 模型体验

此包不添加模型可见的 prompt、tool 或 session event。

它在打包渲染器与嵌入式运行时之间传输既有 DSH JSON RPC envelope；模型可见行为仍由组合出的 DSH plugin 和所选 agent preset 拥有。
