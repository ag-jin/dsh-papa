---
description: "在 Web 侧边栏切换 Harness 主机，并通过 SSH 隧道在框架内操作远端主机自己的 GUI。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-remote-hosts

[English](README.md) | 中文

## 摘要

Web 侧边栏的**远端主机**入口列出已配置的远端 Harness 主机，并打开操作它们的面板。连接一台主机会通过 Host（`remoteHosts.connect`）打开它的 SSH 隧道，并把 Host 返回的隧道源加载进框架，于是远端自己的 GUI 就在面板内启动，带着它的 Workspaces 和 Sessions。面板还可以添加主机——名称、SSH 主机、端口、用户、密码，以及远端与本地端口——并把主机连同它存储的密码一起移除。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与未竟事项](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

在侧边栏选择**远端主机**。面板首次渲染时通过 `remoteHosts` Remote 读取已配置的主机，并在每个操作之后重新读取，因此在其他界面添加的主机会出现在下一次读取里。**连接**打开主机的隧道并把远端 GUI 装入框架；**断开**关闭框架，并随之关闭隧道。移除主机会先询问一次，因为这一步还会忘掉它存储的 SSH 密码。被拒绝的操作会在面板里用一句话说明：主机已不在配置中、该主机未存储 SSH 密码、SSH 连接失败，或本地隧道端口被占用。

**添加主机**打开表单：显示名称、SSH 主机、SSH 端口、SSH 用户、SSH 密码、隧道转发的远端 `dsh web` 端口，以及它绑定的本地回环端口。**保存**会等待每个字段都已填写、每个端口都是可用的 TCP 端口。持久记录的 id 由面板生成；密码只向 Host 发送一次，进入它的凭据存储，面板不会再显示它。

框架加载的是 `connect()` 返回的源——隧道权威——且仅此一处：框架的文档*就是*远端的源，因此其中的 GUI 调用远端的 `/api`、打开它的 WebSocket 时都是同源请求。把 fetch 指向其他任何地方都会跨源，而远端的围栏理应拒绝这种请求。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

### 注册

浏览器插件通过 `ctx.slots.inject()` 注册 `remote-hosts` 侧边栏入口和它的 `main` 面板，与插件入口的做法完全一致；两者都跟随迟到的槽声明，并随插件的 fiber 一起离开。面板是全局的，不属于任何 Session。两个注册共用一个 `MainPanelId`，即 `'remote-hosts'`。

### 控制器

`RemoteHostsController` 持有主机行、忙碌键、被框住的主机及其隧道源，以及最近一次被拒绝的操作。读取按代合并：只有最新一次 `list()` 的答案生效。写入在忙碌键下按每次操作的纪元运行——被更新的写入取代的、或在销毁之后才落定的写入一无所成——并且每个落定的操作都会重新读取 Host，因此主机行始终反映 Host 此刻的答案。被拒绝的操作带着 Host 的失败码进入存储，由面板的词典措辞；添加主机时记录 id 由面板生成（`host-` 加 UUID，按构造即是合法的凭据键段）。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [ui-sidebar](../ui-sidebar/README.zh.md)——入口注册进的面板列表；[ui-layout](../ui-layout/README.zh.md)——面板占据的 main 槽。
- [api-remotes](../../api/remotes/README.zh.md)——`remoteHosts.*` 背后的 Remote BFF 接口。
- [remote-hosts](../../remote/remote-hosts/README.zh.md)——本面板驱动的 Host 侧注册表、凭据记录与隧道。

-----

<a id="model-experience"></a>
## 模型体验

### 远端主机切换器

#### 模型看到什么

没有。本包不注册工具、不注入 prompt、也不追加会话事件；它通过 `ctx.remote.remoteHosts` 渲染操作者配置的远端主机，并框住已连接主机自己的 GUI——后者面向模型的界面属于远端 Harness 自己。

#### Token 影响

零：本包没有任何文本进入模型请求。面板决定的是操作者操作哪台主机，而从不决定模型被要求做什么。

#### KV 缓存影响

无关：面板读取 Remote 应答并发布自己的快照存储，因此这里不会触及请求前缀或提供方的缓存复用。

## 已知限制与未竟事项

这些限制划定切换器的边界；它们是当前的包约束。

- **远端必须允许被嵌入**——当前远端首页不发送 `X-Frame-Options` 或 `frame-ancestors`；未来加入这些头的远端版本会在框架里渲染它的拒绝页，而不是 GUI。
- **仅限同站点嵌入**——框架能工作是因为本地页面与隧道共享 `127.0.0.1` 这个站点，这也是隧道只绑定回环的原因之一；从其他站点服务的页面会拿不到远端的 `SameSite=Strict` cookie。
- **一次只有一个框架**——面板框住最后一次连接的主机；连接另一台主机会把框架指向别处，而先前的隧道会保持打开，直到那台主机被断开。

**运行时不变量：** 不发布伴随包。本包拥有一个侧边栏面板，内容全部来自 Host 持有的事实。
