---
description: "Durable registry of remote Harness hosts reachable over SSH, used by the remote-host connection feature."
kind: "package-reference"
---

# @deepseek-ai/dsh-remote-hosts

[English](README.md) | 中文

## Summary

`dsh-remote-hosts` 存储操作者配置的远端 Harness 主机。每台主机是 `remote_hosts` 存储域中的一条校验记录（`id`、`label`、`host`、`port`、`user`、`remotePort`、`localPort`），而其 SSH 密码与远端 Web 访问令牌是按主机 id 寻址的两条独立 `grant` 凭据记录，因此持久注册表中没有任何记录携带密钥。`RemoteHostRegistry` 是读写界面；暴露它的 Cordis 服务与 Remote API 随远端连接包一同到来。

## Model Experience

### Remote host registry

#### What the model sees

没有。本包不注册工具、不注入 prompt、也不追加会话事件；它把操作者配置的主机存于 `ctx.storageDomain` 之后、把密钥存于 `ctx.credentials` 之后，并且只发出进程内的 `domain/changed` 事件——只有当某个消费者通过它自己的文档化界面渲染该事件时，它才会到达模型。

#### Token effect

零：本包没有任何文本进入模型请求。注册表决定的是操作者可以连接哪台远端主机，而从不决定模型被要求做什么。

#### KV Cache effect

无关：注册表的读写从不触及请求前缀，因此这里不会有任何东西使提供方的缓存复用失效。

## Known Limitations and Deferred Work

- 本注册表写入两种密钥记录：SSH 密码与远端 Web 访问令牌。以密钥认证的主机需要自己的载荷约定，其密钥才能存储于此。
- 注册表在 `load`、`add` 与 `remove` 之后将状态保存在内存中；另一个进程对同一存储域的写入要到下一次 load 才会被观察到。

### Dev Note

<details>
<summary>面向维护者的工作上下文 —— 点击展开</summary>

不发布 invariant companion。注册表拥有持久存储与读写界面，但不拥有任何其观察结果可能分歧的独立运行期关系：读取来自经过校验的内存状态，而存储后端已在持久化边界上强制记录 schema。
</details>
