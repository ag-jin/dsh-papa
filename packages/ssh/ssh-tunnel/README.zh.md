---
description: "供远端主机连接功能使用的、指向远端 Harness Web 服务器的回环 SSH 隧道。"
kind: "package-reference"
---

# @deepseek-ai/dsh-ssh-tunnel

[English](README.md) | 中文

## 概述

`dsh-ssh-tunnel` 建立一条多路复用的 OpenSSH 连接，把一个固定的本地回环端口转发到远端 `dsh web` 端口。它使用密码认证，密码经 `SSH_ASKPASS` 提供给 `ssh`，因此机密永远不会进入 argv；它还对照 DSH 自有的 `known_hosts` 文件校验主机密钥，因此新主机只在首次连接时被信任，密钥变更会被大声拒绝。隧道只绑定回环地址。

## 模型体验

### 隧道流量

#### 模型看到什么

什么都看不到。`SshTunnel` 承载操作者的浏览器流量，在本地页面与远端 Harness 之间传输；没有任何 Session 观察它，本包不贡献任何工具、提示词或请求上下文内容。

#### Token 影响

无直接 token 贡献；隧道字节不会进入模型请求。

#### KV Cache 影响

无直接失效；开启或关闭隧道不改变任何会话历史。

## 已知限制与延后工作

- 密码认证是唯一方式；在加入基于密钥的记录之前，只允许公钥的主机无法连接。
- 本实现派生系统 OpenSSH，因此只支持 POSIX。Windows 需要纯 JS 的载体实现。
- 各隧道相互独立；两条记录指向同一远端端点时没有任何去重。
