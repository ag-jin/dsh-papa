# @deepseek-ai/dsh-desktop-app

[English](README.md) | 中文

`@deepseek-ai/dsh-base` 之上的桌面应用补丁层。它组合现有的存储、工作区、API、客户端功能和桌面运行时条目，但不组合 DSH HTTP 监听器、静态文件回退、浏览器启动、浏览器运行时、客户端 HMR 所有者或基于 HTTP Origin 的信任配置。Electron 应用拥有已打包资源的交付与渲染进程生命周期。该补丁直接选择 native directory-picker provider，并保留 connection core，同时不组合其浏览器传输效果；它挂载 `standard` agent preset，并禁用基础模型可见条目，使每个桌面会话拥有自己的 agent plane。

## 模型体验

### 内嵌传输

#### 模型可见内容

无。`@deepseek-ai/dsh-desktop-app` 只选择应用组合；模型请求由组合出的 agent 和 provider 包拥有。

#### Token 影响

无。此补丁不添加提示词内容或 provider request field。

#### KV Cache 影响

无。此补丁不改变模型可见的 request prefix。

## 已知限制与暂缓事项

- **Electron 进程所有权**：打包渲染器交付、preload IPC 和 macOS 窗口生命周期位于桌面应用包，而非此 Cordis 补丁。
- **浏览器开发流程**：浏览器服务和客户端 HMR 仍属于浏览器端能力，桌面组合有意不包含它们。
