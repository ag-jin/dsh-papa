---
description: "The remote Harness package group: the configured remote hosts, their SSH tunnels, and the sidebar switcher that operates one from the local Web GUI."
kind: "package-group"
---

# remote/ — Remote Harness hosts over SSH

English | [中文](README.zh.md)

## Summary

The remote group lets the local Web GUI operate a DeepSeek Harness on another machine. Each configured host holds one validated record plus its SSH password and remote Web access token in the credential store; connecting opens a loopback-only SSH tunnel to that host's own Web server, and the panel frames the tunnel origin, so the remote's own GUI boots inside the panel with its Workspaces and Sessions. This page maps the group; the package READMEs own the per-package contracts.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role |
|---|---|
| [`remote-hosts/`](remote-hosts/README.md) | Stores the configured hosts and their secrets, and owns one SSH tunnel per host behind the `remoteHosts` Remote namespace |
| [`client/ui-remote-hosts`](../client/ui-remote-hosts/README.md) | The sidebar Remote hosts entry and the panel that adds a host, connects it, and frames its GUI |

-----

<a id="related-documentation"></a>
## Related documentation

- [Design: remote host connection](../../docs/superpowers/specs/2026-09-20-remote-host-connection-design.md) — the measured host-key, fence, cookie, and framing behavior this group rests on.
- [SSH subsystem](../../docs/subsystems/ssh.md) — transport ownership for the loopback tunnel this group opens per host.
- [dsh-ssh-tunnel](../ssh/ssh-tunnel/README.md) — the loopback tunnel package itself.
- [Web client architecture](../../docs/subsystems/web-client.md) — where the sidebar entry and the panel register.

<a id="dev-note"></a>
## Dev Note

The remote Harness is never modified: connecting only opens a tunnel to a server the operator already runs, and disconnecting closes the tunnel while that server keeps running.
