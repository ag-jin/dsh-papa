# 设计：通过 SSH 连接远端主机

Status: proposed

[English](2026-09-20-remote-host-connection-design.md) | 中文

## 问题

DeepSeek Harness 的图形界面由两个客户端应用提供：Electron 桌面端，以及 `dsh web` 提供的浏览器 Web GUI。两者都只驱动一个 Harness Host——即它们被提供或启动时所在的那个。当用户把 Harness 跑在第二台机器上（构建机、家用服务器、实验室工作站）时，无法从任一客户端访问那台机器的会话或工作区：他只能直接对着远端机器开一个浏览器标签页，而这必然要把远端的 Web 服务暴露到网络上。

远端 Web 服务带有可执行远程代码级别的方法（`session.prompt` 会驱动一个能运行 bash 的 agent）。因此它出厂即为仅回环：`packages/bundle/web-app/src/startup.ts` 直接拒绝 `--host 0.0.0.0`，而 `packages/client/connection/src/api-request-trust.ts` 中的 `/api` 栅栏只在请求的 `Host` 为回环或属于已声明的 `trustedHosts` authority 时才接受该请求。

目标是从任一客户端访问远端 Harness 的会话与工作区，并像操作本地会话一样操作远端会话，同时不扩大远端机器的网络暴露面。

## 实测约束

以下均针对运行中的 `dsh web` 实测得到，不是推断。

### 页面 origin 必须与 API origin 一致

`/api` 栅栏把请求的 `Origin` 与 `Host` 作比较：

```
const origin = header(request.headers, 'origin')
if (origin === undefined) return true
try {
  return new URL(origin).host === hostUrl.host
}
```

针对 `127.0.0.1:3091` 上的本地服务实测：

| 请求 `Origin` | 结果 |
|---|---|
| `http://127.0.0.1:3091`（与 `Host` 同 authority） | 404（已路由；栅栏通过） |
| `http://127.0.0.1:9999`（端口不同） | 403（栅栏拒绝） |

因此，从某个 origin 提供的页面无法仅靠把 `fetch` 指向另一个 origin 就去调用其上的 API。朴素方案——页面留在本地 origin，把 API 调用重定向到隧道端口——会被栅栏拒绝。

### 页面经由隧道提供时，栅栏可以通过

在服务的 `127.0.0.1:3091` 前置了一个位于 `127.0.0.1:51080` 的 TCP 转发，并经由该转发请求页面。实测：

| 步骤 | 结果 |
|---|---|
| `GET /?token=…`，`Host: 127.0.0.1:51080` | 303，`Set-Cookie: dsh-auth-…` |
| 携带该 cookie 且 `Origin` 匹配的 `POST /api` | 404（已路由；栅栏与认证通过） |
| 不带 cookie 的 `POST /api` | 401 |

签发的 cookie 其签名载荷携带 `"authority":"127.0.0.1:51080"`——即隧道的 authority，而非服务的真实 authority。这是决定性事实：**页面必须经由调用 API 时的同一个 authority 加载**，且 cookie 绑定到该 authority。隧道端口若在两次运行之间变化，已存储的 cookie 即失效。

### 服务端完全不提供跨源通路

针对本地服务实测了一次携带有效 cookie 的跨源 `POST /api`：

| 请求 | 结果 |
|---|---|
| 经由隧道 authority，`Origin` 匹配 | 404（已路由；栅栏与认证通过） |
| 直接打到服务自身端口，`Origin` 为外来值 | 403（栅栏拒绝） |

服务在任何响应上都不发送 `Access-Control-Allow-*` 头，`OPTIONS` 预检被应答为 403。因此浏览器页面无法调用自身 origin 之外的 API，且客户端的任何头改写都改变不了这一点：`Origin` 由浏览器而非页面组装，而当 CORS 未授权时，浏览器不会把响应交给页面。

### 经由隧道提供的浏览器页面是可行形态

实测了经由隧道请求 GUI 自身：

| 步骤 | 结果 |
|---|---|
| 经由隧道的 `GET /?token=…` | 200，27,660 字节，携带 `<div id="root">` 与 boot 注入 |
| 经由隧道、携带所换 cookie 的 `POST /api` | 404（已路由；栅栏与认证通过） |
| 经由隧道、不带 cookie 的 `POST /api` | 401 |

远端自己的 GUI 包经由隧道提供后完全可用：其页面 origin 等于 API origin，因此栅栏、cookie 交换与 CORS 三者一致，无需任何客户端协议层面改造。

### 桌面端自己的转发由 shell 拥有，无法移植到浏览器

`packages/client/connection/src/client/index.ts` 中的 `ClientTransportHooks` 允许 shell 替换传输层（`fetch`、`openStream`、`streamBaseUrl`），`apps/web/src/main.ts` 为桌面端写入了它——桌面端经 `dsh-app://` 协议加载页面，而 API 位于 `http://127.0.0.1:<port>`。`apps/desktop/src/main.ts`（约第 441 行）改写外发请求的 `origin`、`cookie` 与 `sec-fetch-site`，使栅栏看到的是同源请求。

该机制之所以成立，仅因为 Electron 拥有自己窗口的网络栈。浏览器标签页没有等价钩子。即便撇开栅栏不谈，`Origin` 与 `sec-fetch-site` 也是浏览器禁止页面脚本改写的头，且会话 cookie 为 `HttpOnly; SameSite=Strict`——所以无论写多少客户端 base URL 管线，都无法让页面去调用另一个 origin 上的 API。

### 嵌入 frame 确实可行，并已在真实浏览器中验证

一个位于 `127.0.0.1:51200` 的本地页面，用 `iframe` 嵌入了隧道 origin `127.0.0.1:51100`，此时隧道 origin 已完成认证。在 Microsoft Edge 中实测：

| 观察项 | 结果 |
|---|---|
| frame 渲染出远端 GUI | 侧边栏、工作区与输入框均可见 |
| 远端插件包请求 | 所有 `dsh-*` `client.js` 行均由隧道 origin 提供 |
| 远端 API 调用 | `/api/settings/describe`、`/api/credentials/describe`、`/api/session/modelCatalog` 均有应答 |
| 远端 index 上的 `X-Frame-Options` / `frame-ancestors` | 不存在；未拒绝嵌入 |

其机制在于 `SameSite` 针对 **site** 求值，而 site 忽略端口。本地页面与隧道都位于 `127.0.0.1`，属同一 site，因此 `SameSite=Strict` 的 cookie 会被发送；而 frame 自身文档的 origin 就是隧道 origin，所以其内部每一次 fetch 与 WebSocket 都是同源，均能通过栅栏。认证仍须先针对隧道 origin 建立——本次测试中，cookie 是在嵌入之前直接访问隧道 URL 铸出的。

## 决策

通过 SSH 隧道连接，并经由该隧道的 authority 驱动远端 GUI。

```
Local client
  Web GUI:    the local page keeps the host switcher and embeds the active
              remote's GUI in a frame served through the tunnel authority
  Desktop:    Electron shell forwards to the tunnel authority
        |
        | OpenSSH, multiplexed:
        |   -L 127.0.0.1:<fixed local port>:127.0.0.1:<remote port>
        v
Remote machine
  dsh web, bound to 127.0.0.1 (unmodified)
  existing launch token, cookie auth, and /api fence
```

图中：本地客户端一侧，Web GUI 保留主机切换器，并把当前远端的 GUI 嵌入到一个经由隧道 authority 提供的 frame 中；桌面端由 Electron shell 转发到隧道 authority。中间是 OpenSSH 多路复用转发 `-L 127.0.0.1:<固定的本地端口>:127.0.0.1:<远端端口>`。远端机器上是绑定 `127.0.0.1` 的 `dsh web`（未改动），以及其既有的启动令牌、cookie 认证与 `/api` 栅栏。

远端 Harness 不做改动。它保留自己的回环绑定、自己的令牌与自己的栅栏。认证与信任都是远端自己的，只是经由加密通道抵达。

选择这一形态的理由：

- **frame 是浏览器页面在此处触达另一个 origin 的唯一方式。** 实测的 403、缺失的 CORS 头，以及浏览器禁止的 `Origin`/`sec-fetch-site` 头，共同排除了从页面脚本跨源调用 API 的可能。嵌入的 frame 根本不跨源：它的文档**就是**隧道 origin，因此其自身的 fetch 与 WebSocket 流量均为同源，无需改动即可通过栅栏。
- **浏览器客户端无需任何改动。** 无需 base URL 管线、无需分叉传输层、无需改动服务端栅栏。远端自己提供的包本就与自己的 origin 通信。
- **不增加网络暴露面。** 远端永不绑定非回环地址。这比 `0.0.0.0` 方案严格更安全——后者会把可执行工具调用的 API 以明文 HTTP 发布到网络上，而其 cookie 并不带 `Secure`。
- **无需新的线上协议。** 既有的 Typert Remote/Gateway 栈、会话与工作区 API，以及事件转发全部无需改动即可工作。

## 组成部件

### 1. 隧道所有者（新增）

每个已配置的远端主机一条 SSH 隧道。职责：建立 OpenSSH 连接、保持、上报就绪、拆除，以及重连。

复用判定：`packages/ssh/ssh/src/index.ts` 已用 control master 与多路复用的 `-O forward -L` 控制命令驱动 OpenSSH，且其 `-L` 规格形式原样适用于固定 TCP 端口。但该包的就绪判定、`Config` 与转发 API 全都绑定在 helper 上：它要求 `node`、`helper`、`helperHash` 与 `workspace`，以 helper 的 `hello` 握手加摘要校验作为就绪门槛，并把转发类型限定为 helper 签发的 TLS-PSK 流端点。没有安装远端 helper 它就无法启动，因此无法服务于一条不带 helper 的隧道。

所以本设计新增一个小的独立隧道所有者，复刻那套已验证的多路复用配方，而非复用 `packages/ssh/ssh`。通用部分约 120 行，在那里与 helper 生命周期交织在一起，对单一新消费者而言抽取为时尚早；自然的抽取点出现在第二个转发消费者出现时。新的所有者必须自行提供该包从握手中得到的那一样东西：master 就绪探测（`ssh -O check`）。

### 2. 远端主机注册表（新增）

一份已配置远端主机的持久列表，存放于 `$DSH_HOME` 下（依据用户决定：它随 DSH home 走，而非随工作区走）。每条记录携带：显示别名、OpenSSH 主机别名、远端 `dsh web` 端口、固定的本地隧道端口，以及缓存的浏览器 cookie。

启动令牌本身在远端是按进程生成的，远端每次重启都会变化，因此不是持久记录。持久的是浏览器 cookie，它在同一 authority 上可跨远端重启存续，直到其配置的有效期结束（默认 30 天）。

### 3. 主机切换器 UI（新增）

在插件（Plugins）条目所在位置放置一个侧边栏条目，沿用 `packages/client/ui-plugin-manager/src/client/index.ts` 中的 `sidebar.panellist` 注册模式。本地页面让该切换器始终可见；选中某主机即把 frame 指向该主机的隧道 authority，于是整个面板就成为该主机的**工作区、会话与实时事件**。本地主机是其中一个条目。

依据用户决定的第一阶段范围：手动录入主机（SSH 主机、远端端口、令牌）、远端未运行 `dsh web` 时自动拉起，以及隧道断开后的重连。

由于切换器留在本地页面、而远端 GUI 渲染在 frame 中，本地页面必须先建立隧道 origin 的会话——访问一次隧道的已认证 URL 以铸出 cookie——frame 才能加载。这一引导属于「连接」的一部分，而非需要用户操作的步骤。

### 4. 远端生命周期管理（新增）

连接时探测远端是否已有 `dsh web` 在监听；若没有，则以脱离方式启动一个，并从其 stdout 抓取启动 URL。断开连接永不杀死远端进程——隧道关闭，远端继续运行，与手动启动的 `dsh web` 行为一致。

### 5. 桌面端集成（后续阶段）

桌面端可以经由它自己已拥有的传输钩子（`apps/desktop/src/main.ts` 的头转发）抵达隧道 authority，这比 Web GUI 的 frame 工作更小。它仍被推迟：用户决定先在 Web GUI 中验证该功能，因为桌面端这条路径还额外涉及打包。

## 数据流

1. 用户在侧边栏选中一个远端主机。
2. 注册表解析其记录；隧道所有者确保 SSH 隧道已在该记录固定的本地端口上建立。
3. 本地页面把隧道 origin 导航到远端的已认证启动 URL 一次，将远端的启动令牌换成 frame 所需的、绑定 authority 的 cookie，并把该 cookie 缓存进记录。
4. 本地页面把 frame 指向隧道 authority。frame 的文档就是该 origin，因此远端 GUI 的启动过程与本地完全一致：自己的包、自己的 Gateway WebSocket、自己的会话与工作区调用。
5. 面板显示远端的工作区与会话；它们被像本地会话一样操作，因为干活的是远端 Host。
6. 切回本地主机时，把 frame 指向本地 origin，或将其撤下。

## 错误处理

每种失败都必须给出可操作的成因；「连接失败」不可接受。

| 失败 | 必须给出的报告 |
|---|---|
| SSH 认证被拒 | 指出主机别名，并说明需修正 SSH 凭据或 known-host 条目 |
| 远端没有 `dsh` 或不在 `PATH` 上 | 说明远端没有可运行的 `dsh` |
| 远端 `dsh web` 端口被其他进程占用 | 指出该端口，并说明远端已有服务在跑 |
| 远端重启后令牌过期 | 提供从远端重新读取令牌并重试 |
| 会话中途隧道断开 | 自动重连；若 cookie 仍有效，则无需用户操作 |
| 本地隧道端口已被占用 | 指出该端口及冲突进程 |
| frame 显示远端的 401 | 隧道 origin 的会话从未建立；重新执行令牌交换 |

## 安全

| 方面 | 性质 |
|---|---|
| 传输 | 由 SSH 加密；远端永不绑定非回环地址 |
| 启动令牌 | 只在 SSH 通道内传输；从远端 stdout 抓取，从不经网络 |
| 凭据存储 | 缓存的 cookie 写入 `$DSH_HOME` 下，仅属主可读 |
| 信任 | 远端自己的 `/api` 栅栏与浏览器认证保持不变并完整生效 |
| 影响半径 | 持有该 cookie 即获得远端完整的、可执行工具调用的 API 权限——与本地浏览器会话所持权限相同 |

本设计引入的新暴露面：除用户本就拥有的 SSH 访问外，没有其他。

## 测试

- **单元：** 隧道所有者的 argv 构造、就绪探测与拆除；注册表记录的往返与校验；隧道端口预留与冲突上报。
- **集成：** 在本地 `dsh web` 前置一条真实隧道，证明令牌交换铸出绑定 authority 的 cookie，且经隧道携带 cookie 的 `/api` 调用通过栅栏、不带 cookie 的调用得到 401。这与上文记录的实测一致。
- **嵌入：** 一个嵌入隧道 origin 的本地页面，证明 frame 能启动远端 GUI 并发出自己的远端 API 调用，且必须存在隧道 origin 的会话 frame 才能渲染。这正是上文在 Edge 中实测到的行为。
- **端到端：** 两个 Harness 实例（本地一个，加上一个经隧道抵达的），证明切换器渲染出远端的工作区与会话，且发往远端会话的 prompt 确实在远端执行。
- **快照：** 主机切换器属于产品用户可见变更，按仓库测试策略需要一份无密钥的录制会话快照。

## 范围之外

- 把多个主机合并为一份并发列表（所选模型是一次连一台）。
- 以任何方式改动远端 Harness。
- TLS 终止、反向代理头解释，或把远端 Web 服务发布到网络上。
- 断开时杀死远端进程。

## 未决风险

- **固定的本地端口。** cookie 绑定隧道 authority，因此本地端口不能在两次运行之间变化，否则会强制重新进行令牌交换。注册表必须为每台主机预留一个稳定端口，并在该端口被占用时给出清晰冲突报告。
- **非交互式 SSH 命令下的远端 `PATH`。** 脱离方式启动的远端 `dsh web` 出自非登录 shell，可能不携带用户的 `PATH`。探测必须显式解析 `dsh`，并在无法解析时以清晰消息失败。
- **非交互式 SSH 认证。** 隧道使用批处理模式，因此无法弹出交互式口令提示。需要交互式口令的主机必须预先通过 agent 或免口令密钥完成认证。
- **frame 仅在 same-site 下成立。** 上述嵌入实测之所以成立，是因为本地页面与隧道共享 `127.0.0.1` 这一 site。若本地页面由另一个 site 提供，或隧道暴露在非回环地址上，就会失去 `SameSite=Strict` 的 cookie，frame 将渲染出远端的 401。因此把隧道绑定到回环是正确性要求，而不只是安全偏好。
- **远端的 frame 策略不由我们保证。** 远端 index 当前不发送 `X-Frame-Options` 或 `frame-ancestors`，这正是嵌入得以成立的前提。远端未来版本可能加上它们，因此端到端测试必须断言 frame 确实渲染出来，而不能假定。
