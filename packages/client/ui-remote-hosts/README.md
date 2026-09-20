---
description: "Switch between Harness hosts from the Web sidebar and operate a remote host's own GUI in a frame over its SSH tunnel."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-remote-hosts

English | [中文](README.zh.md)

## Summary

The **Remote hosts** entry in the Web sidebar lists the configured remote Harness hosts and opens the panel that operates them. Connecting a host opens its SSH tunnel through the Host and frames the URL the Host resolves, so the remote's own GUI boots inside the panel with its Workspaces and Sessions; that URL carries the remote's Web access token when the operator stored one, because the remote authenticates its root request. The panel adds a host and removes it together with its stored secrets.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Select **Remote hosts** in the sidebar. The panel reads the configured hosts through the `remoteHosts` Remote when first rendered, and re-reads after every action, so a host added on another surface appears on the next read. **Connect** opens the host's tunnel and frames the resolved URL, whose token exchange authenticates the tunnel authority; **Disconnect** closes the frame and closes the tunnel with it. Removing a host asks once, because it also forgets the host's stored SSH password. A refused action is said in the panel in one sentence: the host is no longer configured, no SSH password is stored for it, the SSH connection failed, or the local tunnel port is taken.

**Add host** opens the form: a display name, the SSH host, the SSH port, the SSH user, the SSH password, the remote `dsh web` port the tunnel forwards to, the local loopback port it binds, and an optional remote access token. **Save** waits until every field is filled and every port is a usable TCP port. The panel mints the durable record's id; the password and any token travel to the Host once, into its credential store, and the panel never shows them again.

The frame loads the origin `connect()` returned — the tunnel authority — and nothing else: the frame's document *is* the remote's origin, so the GUI inside it calls the remote's `/api` and opens its WebSocket as same-origin requests. Pointing fetches anywhere else would cross origins, and the remote's fence rightly refuses that.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Registration

The browser plugin registers the `remote-hosts` sidebar entry and its `main` panel through `ctx.slots.inject()`, exactly as the Plugins entry does; both follow late slot declaration and leave with the plugin's fiber. The panel is global and belongs to no Session. The two registrations share one `MainPanelId`, `'remote-hosts'`.

### The controller

`RemoteHostsController` owns the host rows, the busy keys, the framed host and its tunnel origin, and the last refused action. Reads coalesce by generation: only the newest `list()` answer lands. Writes run under a per-action epoch under a busy key — a superseded write or one taken after disposal settles nowhere — and every settled action re-reads the Host, so the rows always reflect what the Host answers now. A refusal lands in the store as the action plus the Host's failure code, and the panel's dictionary words it; add mints the record id (`host-` plus a UUID, a valid credential-key segment by construction).

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-sidebar](../ui-sidebar/README.md) — the panel list the entry registers into; [ui-layout](../ui-layout/README.md) — the main slot the panel occupies.
- [api-remotes](../../api/remotes/README.md) — the Remote BFF surface behind `remoteHosts.*`.
- [remote-hosts](../../remote/remote-hosts/README.md) — the Host-side registry, credential records, and tunnels this panel drives.

-----

<a id="model-experience"></a>
## Model Experience

### Remote host switcher

#### What the model sees

Nothing. The package registers no tools, injects no prompts, and appends no session events; through `ctx.remote.remoteHosts` it renders the operator's configured remote hosts and frames the connected host's own GUI, whose model-facing surface is the remote Harness's own.

#### Token effect

Zero: no text from this package enters any model request. The panel decides which host the operator operates, never what a model is asked.

#### KV Cache effect

Independent: the panel reads Remote answers and publishes its own snapshot store, so nothing here touches request prefixes or provider cache reuse.

## Known Limitations and Deferred Work

These limits define the reach of the switcher; they are current package constraints.

- **The remote must allow framing** — the remote index currently sends no `X-Frame-Options` or `frame-ancestors`; a future remote version that adds them would render its refusal in the frame instead of the GUI.
- **Same-site embedding only** — the frame works because the local page and the tunnel share the `127.0.0.1` site, which is one reason the tunnel binds loopback only; a page served from a different site would lose the remote's `SameSite=Strict` cookie.
- **One frame at a time** — the panel frames the host of the last connect; connecting another host points the frame elsewhere and leaves the earlier tunnel open until that host is disconnected.

**Runtime invariant:** No companion is published. This package owns a sidebar panel over Host-owned facts.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
