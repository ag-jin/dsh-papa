# @deepseek-ai/dsh-desktop-runtime

[English](README.md) | 中文

桌面运行时为 Electron 主进程提供内嵌的 DSH 请求路径。它提供生命周期监督器、固定的 renderer 桥接权限控制器，以及基于 `toFetchHandler` 的 ApiProxy 适配器。该适配器在进程内工作：不会绑定 TCP 或 UDP 监听器，也不会创建 Web server 服务。

## 生命周期

`DesktopRuntimeSupervisor` 从显式 ApiProxy 工厂启动，并报告 `starting`、`ready`、`degraded`、`stopping` 或 `stopped`。启动失败会进入带错误文本的 `degraded`。停止会先关闭新请求，中止活动 client request，分离所有窗口，并等待收到 abort 信号的一元 dispatch、mux 与 host pump 完成结算（无论成功或拒绝），或等到配置的关闭截止时间后才报告 `stopped`；重复调用 stop 会复用同一个完成 Promise。

运行时按 renderer 窗口与 rpc id 跟踪每个活动的 `client-request`。preload 桥接将取消表示为 JSON 安全的 rpc id；对应的 `AbortController` 由主进程拥有。对于已附加窗口，未知或已完成请求的 id 取消不会产生副作用。

## 桥接权限

`DesktopBridgeAuthority` 只接受主进程已附加的窗口身份和两个固定操作：请求与取消。它通过 ApiProxy schema 校验两种既有 RPC 载体：`ClientRequest` 返回 `ServerResponse`，`ClientResponse` 返回 `RpcReceipt`。它不向 renderer 暴露通用 IPC 操作、文件系统操作、shell 操作或 Electron 对象。

## 模型体验

### 内嵌传输

#### 模型可见内容

无。`DesktopRuntimeSupervisor` 只转发既有 API 消息和生命周期状态，不会向模型请求添加文本、tool 或其他内容。

#### Token 影响

无。此包不组装 provider request，也不改变其 token content。

#### KV Cache 影响

无。此包不改变模型可见的 request prefix。

## 已知限制与暂缓事项

- **Electron presentation**：Electron window construction、preload registration、desktop protocol serving、UI control、recovery presentation 和 macOS packaging 属于独立 desktop layer。
