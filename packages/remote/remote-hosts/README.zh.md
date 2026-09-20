---
description: "Durable registry of remote Harness hosts reachable over SSH, used by the remote-host connection feature."
kind: "package-reference"
---

# @deepseek-ai/dsh-remote-hosts

[English](README.md) | 中文

## Summary

`dsh-remote-hosts` 存储操作者配置的远端 Harness 主机。每台主机是 `remote_hosts` 存储域中的一条校验记录（`id`、`label`、`host`、`port`、`user`、`remotePort`、`localPort`），而每台主机的 SSH 密码是按主机 id 寻址的独立 `grant` 凭据记录，因此持久注册表中没有任何记录携带密钥。`RemoteHostRegistry` 是读写界面；暴露它的 Cordis 服务与 Remote API 随远端连接包一同到来。

## Model Experience

本包不新增工具、prompt 或请求上下文内容。它对模型不可见：它配置的是 harness 可以连接哪些主机，而没有任何会话内容取决于注册表的内容。

## Known Limitations and Deferred Work

- 密码记录是本注册表写入的唯一密钥类型；以密钥认证的主机需要自己的载荷约定，其密钥才能存储于此。
- 注册表在 `load`、`add` 与 `remove` 之后将状态保存在内存中；另一个进程对同一存储域的写入要到下一次 load 才会被观察到。
