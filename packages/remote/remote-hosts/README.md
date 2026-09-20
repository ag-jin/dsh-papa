---
description: "Durable registry of remote Harness hosts reachable over SSH, used by the remote-host connection feature."
kind: "package-reference"
---

# @deepseek-ai/dsh-remote-hosts

## Summary

`dsh-remote-hosts` stores the operator's configured remote Harness hosts. Each host is one validated record (`id`, `label`, `host`, `port`, `user`, `remotePort`, `localPort`) in the `remote_hosts` storage domain, and each host's SSH password is a separate `grant` credential record addressed by the host id, so no durable registry record ever carries a secret. `RemoteHostRegistry` is the read/write surface; the Cordis service and Remote API exposing it arrive with the remote connection package.

## Model Experience

This package adds no tools, prompts, or request-context content. It is invisible to the model: it configures which hosts the harness may connect to, and no Session content depends on the registry's contents.

## Known Limitations and Deferred Work

- Password records are the only secret kind this registry writes; a host that authenticates by key needs its own payload contract before its secret can be stored here.
- The registry holds its state in memory from `load`, `add`, and `remove`; a second process writing the same domain is not observed until the next load.
