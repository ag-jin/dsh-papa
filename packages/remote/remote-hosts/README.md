---
description: "Durable registry of remote Harness hosts reachable over SSH, used by the remote-host connection feature."
kind: "package-reference"
---

# @deepseek-ai/dsh-remote-hosts

English | [中文](README.zh.md)

## Summary

`dsh-remote-hosts` stores the operator's configured remote Harness hosts. Each host is one validated record (`id`, `label`, `host`, `port`, `user`, `remotePort`, `localPort`) in the `remote_hosts` storage domain, and each host's SSH password is a separate `grant` credential record addressed by the host id, so no durable registry record ever carries a secret. `RemoteHostRegistry` is the read/write surface; the Cordis service and Remote API exposing it arrive with the remote connection package.

## Model Experience

### Remote host registry

#### What the model sees

Nothing. The package registers no tools, injects no prompts, and appends no session events; it stores the operator's configured hosts behind `ctx.storageDomain` and their passwords behind `ctx.credentials`, and emits only the in-process `domain/changed` event, which reaches a model only if a consumer renders it through its own documented surface.

#### Token effect

Zero: no text from this package enters any model request. The registry decides which remote host the operator may connect to, never what the model is asked.

#### KV Cache effect

Independent: registry reads and writes never touch request prefixes, so nothing here can invalidate provider cache reuse.

## Known Limitations and Deferred Work

- Password records are the only secret kind this registry writes; a host that authenticates by key needs its own payload contract before its secret can be stored here.
- The registry holds its state in memory from `load`, `add`, and `remove`; a second process writing the same domain is not observed until the next load.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

No invariant companion is published. The registry owns durable storage and a read/write surface but no independent runtime relationship whose observations could diverge: reads come from validated in-memory state, and the storage backend already enforces the record schema at the durability boundary.
</details>
