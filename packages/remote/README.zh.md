---
description: "远端 Harness 包组：已配置的远端主机、它们的 SSH 隧道，以及从本地 Web GUI 操作其中一台的侧边栏切换器。"
kind: "package-group"
---

# remote/：经 SSH 连接远端 Harness 主机

[English](README.md) | 中文

## 概述

remote 组让本地 Web GUI 操作运行在另一台机器上的 DeepSeek Harness。每台已配置主机持有一条校验记录，外加存于凭据库中的 SSH 密码与远端 Web 访问令牌；连接会向该主机自己的 Web 服务器打开仅绑回环的 SSH 隧道，面板则加载隧道源，于是远端自己的 GUI 就在面板内启动，带着它的 Workspaces 和 Sessions。本页概述该包组；各包的具体约定由其 README 规定。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 |
|---|---|
| [`remote-hosts/`](remote-hosts/README.zh.md) | 存储已配置主机及其密钥，并在 `remoteHosts` Remote 命名空间之后为每台主机持有一条 SSH 隧道 |
| [`client/ui-remote-hosts`](../client/ui-remote-hosts/README.zh.md) | 侧边栏的「远端主机」入口，以及添加主机、连接它并加载其 GUI 的面板 |

-----

<a id="related-documentation"></a>
## 相关文档

- [设计：远端主机连接](../../docs/superpowers/specs/2026-09-20-remote-host-connection-design.zh.md)——本包组所依据的、实测得到的主机密钥、围栏、cookie 与框架行为。
- [SSH 子系统](../../docs/subsystems/ssh.zh.md)——本包组为每台主机打开的仅回环隧道的传输归属。
- [dsh-ssh-tunnel](../ssh/ssh-tunnel/README.zh.md)——隧道包本身。
- [Web 客户端架构](../../docs/subsystems/web-client.zh.md)——侧边栏入口与面板注册的位置。

<a id="dev-note"></a>
## 开发备注

远端 Harness 从不被修改：连接只是向操作者已在运行的服务器打开一条隧道，断开则关闭隧道，而该服务器继续运行。
