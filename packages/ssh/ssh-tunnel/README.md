---
description: "Loopback SSH tunnel to a remote Harness Web server, used by the remote-host connection feature."
kind: "package-reference"
---

# @deepseek-ai/dsh-ssh-tunnel

English | [中文](README.zh.md)

## Summary

`dsh-ssh-tunnel` opens one multiplexed OpenSSH connection and forwards a fixed local loopback port to a remote `dsh web` port. It authenticates by password, supplied to `ssh` through `SSH_ASKPASS` so the secret never reaches argv, and it verifies host keys against a DSH-owned `known_hosts` file, so a new host is trusted once and a changed key is refused. The tunnel binds loopback only.

## Model Experience

### Tunnel traffic

#### What the model sees

Nothing. `SshTunnel` carries the operator's browser traffic between the local page and the remote Harness; no Session observes it, and this package contributes no tools, prompts, or request-context content.

#### Token effect

No direct token contribution; tunnel bytes never enter a model request.

#### KV Cache effect

No direct invalidation; opening or closing a tunnel changes no conversation history.

## Known Limitations and Deferred Work

- Password authentication is the only method; a host permitting only public keys is unreachable until key-based records are added.
- The implementation spawns system OpenSSH, so it is POSIX-only. Windows needs a pure-JS carrier instead.
- Tunnels are independent; nothing deduplicates two records naming the same remote endpoint.
