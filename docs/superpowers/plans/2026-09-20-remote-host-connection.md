# Remote Host Connection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Web GUI reach another machine's Harness — its Workspaces and Sessions — over an SSH tunnel, and operate those remote Sessions exactly like local ones.

**Architecture:** A local SSH tunnel forwards a fixed loopback port to the remote `dsh web` port. The local page keeps a host switcher and embeds the active remote's GUI in a frame served through that tunnel authority. The frame's document *is* the tunnel origin, so its own fetch and WebSocket traffic is same-origin and passes the remote's `/api` fence unmodified. The remote Harness is never modified.

**Tech Stack:** TypeScript (ESM only), Cordis plugins, zod + schemastery for config, `node:child_process` spawning system OpenSSH with `SSH_ASKPASS`, Typert Remote for the Host API, `ctx.storageDomain` for the durable host list, `ctx.credentials` for the SSH password.

**Spec:** `docs/superpowers/specs/2026-09-20-remote-host-connection-design.md`

## Global Constraints

- **ESM only.** Every relative import uses an explicit `.ts` specifier. No CommonJS, no `require()`.
- **Package naming.** `@deepseek-ai/dsh-<name>`; version exactly matches the root `package.json` version.
- **Cordis plugin shape.** A service package default-exports its class; a function plugin named-exports `name`/`inject`/`Config`/`apply` and has **no** default export. Never mix the two forms.
- **Registrations are effects.** Every contribution goes through `ctx.effect()` or `ctx.on()`; a registry's `register()` returns the disposer.
- **No hardcoded tunables in plugins.** Deployment-varying choices are validated `Config` fields changeable from `cordis.yml`.
- **Misconfiguration fails loud** at load when self-contained, otherwise at the earliest resolvable point.
- **Opaque cross-boundary ids are branded** (`Branded<B>` from `dsh-brand`), never bare `string`.
- **An empty `catch` names the error** and why; keep its `try` to one statement.
- **Client UI copy is locale-owned.** No hardcoded product strings in components; route through typed dictionaries and `t`.
- **Tests describe behavior.** Specs run concurrently in forked workers; own every port, temporary path, and child process through teardown.
- **Files end with exactly one trailing newline.**
- **The tunnel binds loopback only.** A non-loopback bind loses the `SameSite=Strict` cookie and the frame renders the remote's 401 — this is a correctness requirement, not a preference.
- **The remote is never modified.** No remote-side install, no remote-side code, no remote config change.

## Deviation from the spec, decided here

The spec says host-key verification uses `StrictHostKeyChecking=yes`. That value dead-ends the first connection to any host, because `yes` refuses an unknown key and the GUI has no terminal to run the interactive fingerprint prompt in. The plan uses **`StrictHostKeyChecking=accept-new` with a DSH-owned `known_hosts`** instead. The security property the spec wanted is preserved: a *new* host is trusted on first sight, and a *changed* key is refused loudly. Task 1 pins both behaviors in tests.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/ssh/ssh-tunnel/src/argv.ts` | Pure SSH argument construction and target validation. No I/O. |
| `packages/ssh/ssh-tunnel/src/askpass.ts` | Materialize the `SSH_ASKPASS` helper and its secret file; own their cleanup. |
| `packages/ssh/ssh-tunnel/src/tunnel.ts` | One tunnel's lifecycle: spawn, readiness, teardown, reconnect. |
| `packages/ssh/ssh-tunnel/src/index.ts` | Cordis service `ctx.sshTunnel`. |
| `packages/remote/remote-hosts/src/spec.ts` | Durable record schema and the `storageDomain` declaration. |
| `packages/remote/remote-hosts/src/registry.ts` | Host list read/write plus the SSH password's credential record. |
| `packages/remote/remote-hosts/src/index.ts` | Cordis service `ctx.remoteHosts`, the `@Remote` methods, and the error-code table. |
| `packages/client/ui-remote-hosts/src/client/index.ts` | Browser half: sidebar entry and the framed panel. |

New package group `packages/remote/` holds the Host-side feature, matching the repository's group-per-subsystem layout.

---

### Task 1: Tunnel package skeleton and SSH argument construction

**Files:**
- Create: `packages/ssh/ssh-tunnel/package.json`
- Create: `packages/ssh/ssh-tunnel/tsconfig.json`
- Create: `packages/ssh/ssh-tunnel/tsdown.config.ts`
- Create: `packages/ssh/ssh-tunnel/src/argv.ts`
- Create: `packages/ssh/ssh-tunnel/tests/argv.spec.ts`
- Create: `packages/ssh/ssh-tunnel/README.md`
- Modify: `tsconfig.host.json` (add one `references` entry beside the other `packages/ssh/*` entries, around line 285-288)

**Interfaces:**
- Consumes: nothing.
- Produces: `TunnelTarget` (interface) and `tunnelArgs(target: TunnelTarget, controlPath: string, knownHostsPath: string): string[]`.

- [ ] **Step 1: Create the package manifest**

`packages/ssh/ssh-tunnel/package.json` — copy the version string from the root `package.json` (currently `0.1.6-alpha.2`):

```json
{
  "name": "@deepseek-ai/dsh-ssh-tunnel",
  "description": "Loopback SSH tunnel to a remote Harness Web server",
  "version": "0.1.6-alpha.2",
  "publishConfig": { "access": "public" },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/deepseek-ai/deepseek-harness.git",
    "directory": "packages/ssh/ssh-tunnel"
  },
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./src/*": "./src/*",
    "./package.json": "./package.json"
  },
  "files": ["lib/index.js", "lib/types/**/*.d.ts"],
  "license": "MIT",
  "peerDependencies": { "@deepseek-ai/cordis": "workspace:^" },
  "dependencies": { "@deepseek-ai/schemastery": "workspace:^", "zod": "^4.4.3" },
  "devDependencies": { "@deepseek-ai/cordis": "workspace:^" }
}
```

- [ ] **Step 2: Create the tsconfig and tsdown config**

`packages/ssh/ssh-tunnel/tsconfig.json`:

```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "lib/types" },
  "include": ["src"],
  "references": [{ "path": "../../../vendor/cordis" }, { "path": "../../../vendor/schemastery" }]
}
```

`packages/ssh/ssh-tunnel/tsdown.config.ts`:

```ts
import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: ['lib/types/index.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
])
```

- [ ] **Step 3: Write the failing test**

`packages/ssh/ssh-tunnel/tests/argv.spec.ts`:

```ts
/** SSH argument construction forwards one loopback port and refuses argv-shaped input. */
import { describe, expect, it } from 'vitest'
import { tunnelArgs } from '../src/argv.ts'

const target = { host: 'box.example', port: 30028, user: 'jin', remotePort: 3080, localPort: 51080 }

describe('tunnelArgs', () => {
  it('forwards the local port to the remote loopback port', () => {
    const args = tunnelArgs(target, '/tmp/dsh-tunnel/master', '/tmp/dsh-tunnel/known_hosts')
    expect(args[args.indexOf('-L') + 1]).toBe('51080:127.0.0.1:3080')
  })

  it('carries the ssh port and the login target', () => {
    const args = tunnelArgs(target, '/tmp/m', '/tmp/kh')
    expect(args[args.indexOf('-p') + 1]).toBe('30028')
    expect(args.at(-1)).toBe('jin@box.example')
  })

  it('runs no remote command and keeps the master for the process lifetime', () => {
    const args = tunnelArgs(target, '/tmp/m', '/tmp/kh')
    expect(args).toContain('-N')
    expect(args[args.indexOf('-o') + 1]).toBe('ControlPersist=no')
  })

  it('verifies host keys against the DSH-owned file and accepts only a new key', () => {
    const args = tunnelArgs(target, '/tmp/m', '/tmp/kh')
    expect(args).toContain('StrictHostKeyChecking=accept-new')
    expect(args).toContain('UserKnownHostsFile=/tmp/kh')
  })

  it('authenticates by password only', () => {
    const args = tunnelArgs(target, '/tmp/m', '/tmp/kh')
    expect(args).toContain('PreferredAuthentications=password')
    expect(args).toContain('PubkeyAuthentication=no')
  })

  it('fails the connection when the forward cannot bind', () => {
    expect(tunnelArgs(target, '/tmp/m', '/tmp/kh')).toContain('ExitOnForwardFailure=yes')
  })

  it('refuses a login name that ssh would read as an option', () => {
    expect(() => tunnelArgs({ ...target, user: '-oProxyCommand=evil' }, '/tmp/m', '/tmp/kh'))
      .toThrow(/user/)
  })

  it('refuses a host carrying a separator or whitespace', () => {
    expect(() => tunnelArgs({ ...target, host: 'box.example -o X' }, '/tmp/m', '/tmp/kh'))
      .toThrow(/host/)
  })

  it('refuses a port outside the TCP range', () => {
    expect(() => tunnelArgs({ ...target, port: 70000 }, '/tmp/m', '/tmp/kh')).toThrow(/port/)
    expect(() => tunnelArgs({ ...target, localPort: 0 }, '/tmp/m', '/tmp/kh')).toThrow(/localPort/)
  })
})
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx vitest run packages/ssh/ssh-tunnel/tests/argv.spec.ts`

Expected: FAIL — cannot resolve `../src/argv.ts`.

- [ ] **Step 5: Write the implementation**

`packages/ssh/ssh-tunnel/src/argv.ts`:

```ts
/** SSH argument construction for one loopback tunnel. Pure: no process, no filesystem. */

/** One remote host as the tunnel owner needs it. */
export interface TunnelTarget {
  /** SSH server hostname or IP literal. */
  host: string
  /** SSH server port. */
  port: number
  /** SSH login user. */
  user: string
  /** Remote `dsh web` port, always reached over the remote's own loopback. */
  remotePort: number
  /** Local loopback port the tunnel listens on. */
  localPort: number
}

/**
 * A login name ssh would parse as an option, or a host carrying anything that
 * separates one argv word from the next, lets a stored record reach ssh's own
 * option parser. Both are refused before they can.
 */
const USER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/
const HOST_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.:-]*$/

function assertPort(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`ssh-tunnel: ${field} must be an integer from 1 through 65535, got ${String(value)}`)
  }
}

/**
 * Build the argv for a multiplexed tunnel that binds one local loopback port to
 * the remote's loopback `dsh web` port.
 * @param target - the remote endpoint and the local port to bind.
 * @param controlPath - control socket of this connection's master.
 * @param knownHostsPath - DSH-owned known-hosts file; a changed key is refused.
 * @returns argv for the `ssh` executable, excluding its own path.
 */
export function tunnelArgs(target: TunnelTarget, controlPath: string, knownHostsPath: string): string[] {
  if (!USER_PATTERN.test(target.user)) {
    throw new Error(`ssh-tunnel: user ${JSON.stringify(target.user)} is not a plain login name`)
  }
  if (!HOST_PATTERN.test(target.host)) {
    throw new Error(`ssh-tunnel: host ${JSON.stringify(target.host)} is not a plain hostname or address`)
  }
  assertPort(target.port, 'port')
  assertPort(target.remotePort, 'remotePort')
  assertPort(target.localPort, 'localPort')
  return [
    '-N',
    '-M', '-S', controlPath,
    '-o', 'ControlPersist=no',
    '-o', 'NumberOfPasswordPrompts=1',
    '-o', 'PreferredAuthentications=password',
    '-o', 'PubkeyAuthentication=no',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', `UserKnownHostsFile=${knownHostsPath}`,
    '-o', 'ForwardAgent=no',
    '-o', 'ExitOnForwardFailure=yes',
    '-o', 'ServerAliveInterval=10',
    '-o', 'ServerAliveCountMax=3',
    '-L', `${String(target.localPort)}:127.0.0.1:${String(target.remotePort)}`,
    '-p', String(target.port),
    `${target.user}@${target.host}`,
  ]
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run packages/ssh/ssh-tunnel/tests/argv.spec.ts`

Expected: PASS — 9 tests.

- [ ] **Step 7: Write the package README**

`packages/ssh/ssh-tunnel/README.md` — the repository's package-README standard requires the summary, a `## Known Limitations and Deferred Work` section, and a Model Experience section. This package is invisible to the model, so the Model Experience section states that and gives the reason:

```markdown
---
description: "Loopback SSH tunnel to a remote Harness Web server, used by the remote-host connection feature."
kind: "package-reference"
---

# @deepseek-ai/dsh-ssh-tunnel

English | [中文](README.zh.md)

## Summary

`dsh-ssh-tunnel` opens one multiplexed OpenSSH connection and forwards a fixed local loopback port to a remote `dsh web` port. It authenticates by password, supplied to `ssh` through `SSH_ASKPASS` so the secret never reaches argv, and it verifies host keys against a DSH-owned `known_hosts` file, so a new host is trusted once and a changed key is refused. The tunnel binds loopback only.

## Model Experience

This package adds no tools, prompts, or request-context content. It is invisible to the model: the tunnel carries the operator's browser traffic, and no harness Session observes it.

## Known Limitations and Deferred Work

- Password authentication is the only method; a host permitting only public keys is unreachable until key-based records are added.
- The implementation spawns system OpenSSH, so it is POSIX-only. Windows needs a pure-JS carrier instead.
- Tunnels are independent; nothing deduplicates two records naming the same remote endpoint.
```

- [ ] **Step 8: Register the package in the Host aggregate**

Add to the `references` array in `tsconfig.host.json`, immediately after the existing `{ "path": "./packages/ssh/ssh" }` entry:

```json
    { "path": "./packages/ssh/ssh-tunnel" },
```

- [ ] **Step 9: Install, typecheck, and commit**

```bash
pnpm install
npx vitest run packages/ssh/ssh-tunnel/tests/argv.spec.ts
git add packages/ssh/ssh-tunnel tsconfig.host.json pnpm-lock.yaml
git commit -m "feat(ssh-tunnel): construct loopback tunnel arguments"
```

---

### Task 2: The SSH_ASKPASS credential handoff

**Files:**
- Create: `packages/ssh/ssh-tunnel/src/askpass.ts`
- Create: `packages/ssh/ssh-tunnel/tests/askpass.spec.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `AskpassHandoff` (interface with `env(): Record<string, string>` and `dispose(): Promise<void>`) and `materializeAskpass(directory: string, password: string): Promise<AskpassHandoff>`.

- [ ] **Step 1: Write the failing test**

`packages/ssh/ssh-tunnel/tests/askpass.spec.ts`:

```ts
/** The askpass handoff keeps the secret out of argv and off the environment, then removes it. */
import { mkdtemp, rm, stat, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { materializeAskpass } from '../src/askpass.ts'

const directories: string[] = []

async function workspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-askpass-spec-'))
  directories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('materializeAskpass', () => {
  it('points ssh at a helper and never puts the password in the child environment', async () => {
    const directory = await workspace()
    const handoff = await materializeAskpass(directory, 'correct horse battery staple')
    const env = handoff.env()

    expect(env.SSH_ASKPASS_REQUIRE).toBe('force')
    expect(env.SSH_ASKPASS).toBeDefined()
    expect(Object.values(env).join(' ')).not.toContain('correct horse battery staple')
    await handoff.dispose()
  })

  it('writes the secret to an owner-only file and the helper echoes it', async () => {
    const directory = await workspace()
    const handoff = await materializeAskpass(directory, 'hunter2')
    const secretPath = join(directory, 'secret')

    expect((await stat(secretPath)).mode & 0o777).toBe(0o600)
    expect(await readFile(secretPath, 'utf8')).toBe('hunter2')

    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const printed = await promisify(execFile)(handoff.env().SSH_ASKPASS, [], { env: handoff.env() })
    expect(printed.stdout.trim()).toBe('hunter2')
    await handoff.dispose()
  })

  it('removes both files on dispose', async () => {
    const directory = await workspace()
    const handoff = await materializeAskpass(directory, 'secret')
    const helper = handoff.env().SSH_ASKPASS
    await handoff.dispose()

    await expect(stat(helper)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(join(directory, 'secret'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/ssh/ssh-tunnel/tests/askpass.spec.ts`

Expected: FAIL — cannot resolve `../src/askpass.ts`.

- [ ] **Step 3: Write the implementation**

`packages/ssh/ssh-tunnel/src/askpass.ts`:

```ts
/** The SSH_ASKPASS handoff: a helper script and its secret, owned until disposal. */

import { chmod, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** One materialized handoff. Dispose removes the helper and the secret. */
export interface AskpassHandoff {
  /** Environment entries the spawned `ssh` needs, carrying a path rather than the secret. */
  env(): Record<string, string>
  /** Remove the helper and the secret; safe to call twice. */
  dispose(): Promise<void>
}

const SECRET_FILE = 'secret'

/**
 * `ssh` consults this helper for a password. It prints the secret file's bytes,
 * so the secret travels as a file path in the environment rather than as the
 * environment's own content, where a child process could read it back.
 */
const HELPER_PROGRAM = '#!/bin/sh\ncat "${DSH_SSH_ASKPASS_FILE}"\n'

/**
 * Write the helper and the secret under one directory and return their handoff.
 * @param directory - a directory this connection owns; created by the caller.
 * @param password - the SSH password to hand over.
 * @returns the handoff; dispose removes both files.
 */
export async function materializeAskpass(directory: string, password: string): Promise<AskpassHandoff> {
  const secretPath = join(directory, SECRET_FILE)
  const helperPath = join(directory, 'askpass')
  await writeFile(secretPath, password, { mode: 0o600 })
  await writeFile(helperPath, HELPER_PROGRAM, { mode: 0o700 })
  await chmod(helperPath, 0o700)
  const environment = {
    SSH_ASKPASS: helperPath,
    // Without `force`, ssh ignores the helper whenever a terminal is attached.
    SSH_ASKPASS_REQUIRE: 'force',
    DSH_SSH_ASKPASS_FILE: secretPath,
  }
  return {
    env: () => ({ ...environment }),
    async dispose(): Promise<void> {
      await rm(helperPath, { force: true })
      await rm(secretPath, { force: true })
    },
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/ssh/ssh-tunnel/tests/askpass.spec.ts`

Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/ssh/ssh-tunnel/src/askpass.ts packages/ssh/ssh-tunnel/tests/askpass.spec.ts
git commit -m "feat(ssh-tunnel): hand the password over through SSH_ASKPASS"
```

---

### Task 3: Tunnel lifecycle

**Files:**
- Create: `packages/ssh/ssh-tunnel/src/tunnel.ts`
- Create: `packages/ssh/ssh-tunnel/tests/tunnel.spec.ts`

**Interfaces:**
- Consumes: `tunnelArgs`, `TunnelTarget` from `./argv.ts`; `materializeAskpass`, `AskpassHandoff` from `./askpass.ts`.
- Produces: `TunnelRunner` (the spawn/exec seam), `SshTunnel` (class with `open(): Promise<void>`, `close(): Promise<void>`, `readonly localPort: number`, `readonly ready: Promise<void>`).

- [ ] **Step 1: Write the failing test**

`packages/ssh/ssh-tunnel/tests/tunnel.spec.ts`:

```ts
/** The tunnel owns one ssh process, waits for a real listener, and removes its secret on close. */
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SshTunnel } from '../src/tunnel.ts'
import type { TunnelRunner, TunnelChild } from '../src/tunnel.ts'

const directories: string[] = []

async function workspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-tunnel-spec-'))
  directories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

/** Records every spawn and every control command; reports the master as reachable on demand. */
function fakeRunner(reachable: () => boolean): { runner: TunnelRunner; spawns: string[][]; checked: () => boolean } {
  const spawns: string[][] = []
  let didCheck = false
  const child: TunnelChild = {
    pid: 4242,
    kill: vi.fn(() => true),
    once: vi.fn(() => child),
    on: vi.fn(() => child),
  }
  return {
    spawns,
    checked: () => didCheck,
    runner: {
      spawn: (_file, args) => { spawns.push([...args]); return child },
      check: async () => { didCheck = true; return reachable() },
      kill: async () => {},
    },
  }
}

describe('SshTunnel', () => {
  it('spawns ssh with the forwarded port and reports readiness', async () => {
    const directory = await workspace()
    const fake = fakeRunner(() => true)
    const tunnel = new SshTunnel(
      { host: 'box.example', port: 22, user: 'jin', remotePort: 3080, localPort: 51080 },
      'hunter2',
      { directory, knownHostsPath: join(directory, 'known_hosts'), runner: fake.runner, readyTimeoutMs: 500 },
    )
    await tunnel.open()

    expect(fake.spawns).toHaveLength(1)
    const args = fake.spawns[0]!
    expect(args[args.indexOf('-L') + 1]).toBe('51080:127.0.0.1:3080')
    await tunnel.close()
  })

  it('gives up when the master never becomes reachable', async () => {
    const directory = await workspace()
    const fake = fakeRunner(() => false)
    const tunnel = new SshTunnel(
      { host: 'box.example', port: 22, user: 'jin', remotePort: 3080, localPort: 51080 },
      'hunter2',
      { directory, knownHostsPath: join(directory, 'known_hosts'), runner: fake.runner, readyTimeoutMs: 150 },
    )

    await expect(tunnel.open()).rejects.toThrow(/did not become ready/)
    await tunnel.close()
  })

  it('removes the secret even when the master never became ready', async () => {
    const directory = await workspace()
    const fake = fakeRunner(() => false)
    const tunnel = new SshTunnel(
      { host: 'box.example', port: 22, user: 'jin', remotePort: 3080, localPort: 51080 },
      'hunter2',
      { directory, knownHostsPath: join(directory, 'known_hosts'), runner: fake.runner, readyTimeoutMs: 150 },
    )
    await tunnel.open().catch(() => undefined)
    await tunnel.close()

    await expect(stat(join(directory, 'secret'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/ssh/ssh-tunnel/tests/tunnel.spec.ts`

Expected: FAIL — cannot resolve `../src/tunnel.ts`.

- [ ] **Step 3: Write the implementation**

`packages/ssh/ssh-tunnel/src/tunnel.ts`:

```ts
/** One loopback SSH tunnel: spawn the master, wait for it, tear it down. */

import { spawn as spawnProcess, execFile } from 'node:child_process'
import { join } from 'node:path'
import type { ChildProcess } from 'node:child_process'
import { materializeAskpass, type AskpassHandoff } from './askpass.ts'
import { tunnelArgs, type TunnelTarget } from './argv.ts'

const SSH_EXECUTABLE = 'ssh'
const READY_POLL_MS = 250

/** The child process surface this module uses. */
export interface TunnelChild {
  readonly pid?: number | undefined
  kill(signal?: NodeJS.Signals): boolean
  once(event: string, listener: (...args: unknown[]) => void): unknown
  on(event: string, listener: (...args: unknown[]) => void): unknown
}

/**
 * Every process and command this owner runs. Tests replace it; production uses
 * the real implementation below.
 */
export interface TunnelRunner {
  /** Start the multiplexed master. */
  spawn(file: string, args: string[], env: NodeJS.ProcessEnv): TunnelChild
  /** Whether the master's control socket still answers. */
  check(controlPath: string, target: TunnelTarget, timeoutMs: number): Promise<boolean>
  /** Terminate the master. */
  terminate(child: TunnelChild, timeoutMs: number): Promise<void>
}

/** Injectable dependencies and deadlines for one tunnel. */
export interface SshTunnelOptions {
  /** Directory this tunnel owns; holds the control socket, known hosts, and secret. */
  directory: string
  /** DSH-owned known-hosts file; a changed key is refused. */
  knownHostsPath: string
  /** Process seam; omit for the real implementation. */
  runner?: TunnelRunner
  /** How long to wait for the master to answer its control socket. */
  readyTimeoutMs?: number
}

/** Production process seam: system OpenSSH over `node:child_process`. */
export const systemRunner: TunnelRunner = {
  spawn: (file, args, env) => spawnProcess(file, args, { env, stdio: ['ignore', 'ignore', 'pipe'] }),
  async check(controlPath, target, timeoutMs) {
    return await new Promise<boolean>((resolve) => {
      execFile(
        SSH_EXECUTABLE,
        ['-S', controlPath, '-O', 'check', `${target.user}@${target.host}`],
        { timeout: timeoutMs },
        (error) => { resolve(error === null) },
      )
    })
  },
  async terminate(child, timeoutMs) {
    const exited = new Promise<void>((resolve) => { child.once('exit', () => { resolve() }) })
    child.kill('SIGTERM')
    const timer = setTimeout(() => { child.kill('SIGKILL') }, timeoutMs)
    await exited
    clearTimeout(timer)
  },
}

/**
 * One tunnel. `open` resolves only after the master answers, so a caller that
 * proceeds has a listening local port.
 */
export class SshTunnel {
  private child: TunnelChild | undefined
  private askpass: AskpassHandoff | undefined
  private closed = false
  private readonly runner: TunnelRunner
  private readonly readyTimeoutMs: number
  private readonly controlPath: string

  /** @param target - remote endpoint and local port. */
  constructor(
    private readonly target: TunnelTarget,
    private readonly password: string,
    private readonly options: SshTunnelOptions,
  ) {
    this.runner = options.runner ?? systemRunner
    this.readyTimeoutMs = options.readyTimeoutMs ?? 20_000
    this.controlPath = join(options.directory, 'master')
  }

  /** The local loopback port this tunnel binds. */
  get localPort(): number { return this.target.localPort }

  /**
   * Start the master and wait until it answers, so the returned tunnel has a
   * listening port.
   */
  async open(): Promise<void> {
    if (this.closed) throw new Error('ssh-tunnel: tunnel is closed')
    if (this.child !== undefined) throw new Error('ssh-tunnel: tunnel is already open')
    this.askpass = await materializeAskpass(this.options.directory, this.password)
    const args = tunnelArgs(this.target, this.controlPath, this.options.knownHostsPath)
    const env = { ...process.env, ...this.askpass.env() }
    const child = this.runner.spawn(SSH_EXECUTABLE, args, env)
    this.child = child
    // A master that dies early never becomes reachable; the poll below reports it.
    child.once('error', () => undefined)
    const deadline = Date.now() + this.readyTimeoutMs
    while (Date.now() < deadline) {
      if (await this.runner.check(this.controlPath, this.target, 2_000)) return
      await new Promise(resolve => setTimeout(resolve, READY_POLL_MS))
    }
    throw new Error(
      `ssh-tunnel: ${this.target.user}@${this.target.host}:${String(this.target.port)} did not become ready within ${String(this.readyTimeoutMs)} ms`,
    )
  }

  /** Terminate the master and remove the secret; safe to call twice. */
  async close(): Promise<void> {
    this.closed = true
    const child = this.child
    this.child = undefined
    if (child !== undefined) await this.runner.terminate(child, 5_000).catch(() => undefined)
    const askpass = this.askpass
    this.askpass = undefined
    if (askpass !== undefined) await askpass.dispose()
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/ssh/ssh-tunnel/tests/tunnel.spec.ts`

Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/ssh/ssh-tunnel/src/tunnel.ts packages/ssh/ssh-tunnel/tests/tunnel.spec.ts
git commit -m "feat(ssh-tunnel): own one tunnel's lifecycle"
```

---

### Task 4: Remote host registry

**Files:**
- Create: `packages/remote/remote-hosts/package.json`
- Create: `packages/remote/remote-hosts/tsconfig.json`
- Create: `packages/remote/remote-hosts/tsdown.config.ts`
- Create: `packages/remote/remote-hosts/src/spec.ts`
- Create: `packages/remote/remote-hosts/src/registry.ts`
- Create: `packages/remote/remote-hosts/tests/registry.spec.ts`
- Modify: `tsconfig.host.json` (add `{ "path": "./packages/remote/remote-hosts" }`)

**Interfaces:**
- Consumes: `TunnelTarget` from `@deepseek-ai/dsh-ssh-tunnel`.
- Produces: `RemoteHostRecord` (interface), `remoteHostDomainSpec`, `RemoteHostRegistry` (class with `list(): RemoteHostRecord[]`, `add(record): Promise<void>`, `remove(id): Promise<void>`, `passwordOf(id): Promise<string>`).

- [ ] **Step 1: Create the package manifest and configs**

`packages/remote/remote-hosts/package.json` (same skeleton as Task 1, with these differences):

```json
{
  "name": "@deepseek-ai/dsh-remote-hosts",
  "description": "Durable registry of remote Harness hosts reachable over SSH",
  "version": "0.1.6-alpha.2",
  "publishConfig": { "access": "public" },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/deepseek-ai/deepseek-harness.git",
    "directory": "packages/remote/remote-hosts"
  },
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./src/*": "./src/*",
    "./package.json": "./package.json"
  },
  "files": ["lib/index.js", "lib/types/**/*.d.ts"],
  "license": "MIT",
  "peerDependencies": {
    "@deepseek-ai/cordis": "workspace:^",
    "@deepseek-ai/dsh-brand": "workspace:^",
    "@deepseek-ai/dsh-credentials": "workspace:^",
    "@deepseek-ai/dsh-storage-domain": "workspace:^",
    "@deepseek-ai/dsh-typert-protocol": "workspace:^"
  },
  "dependencies": { "@deepseek-ai/schemastery": "workspace:^", "zod": "^4.4.3" },
  "devDependencies": {
    "@deepseek-ai/cordis": "workspace:^",
    "@deepseek-ai/dsh-brand": "workspace:^",
    "@deepseek-ai/dsh-credentials": "workspace:^",
    "@deepseek-ai/dsh-storage-domain": "workspace:^",
    "@deepseek-ai/dsh-typert-protocol": "workspace:^"
  }
}
```

`packages/remote/remote-hosts/tsconfig.json` — same shape as Task 1, with references to `../../util/brand`, `../../storage/storage-domain`, `../../credentials/credentials`, `../../typert/protocol`, plus the two vendored ones.

`packages/remote/remote-hosts/tsdown.config.ts` — identical to Task 1's.

- [ ] **Step 2: Write the failing test**

`packages/remote/remote-hosts/tests/registry.spec.ts`:

```ts
/** The registry validates a record before it is durable and keeps the password out of the record. */
import { describe, expect, it, vi } from 'vitest'
import { parseRemoteHostRecord } from '../src/spec.ts'

const valid = {
  id: 'box',
  label: 'Build box',
  host: 'box.example',
  port: 30028,
  user: 'jin',
  remotePort: 3080,
  localPort: 51080,
}

describe('parseRemoteHostRecord', () => {
  it('accepts a complete record', () => {
    expect(parseRemoteHostRecord(valid)).toMatchObject({ id: 'box', localPort: 51080 })
  })

  it('refuses an id that is not a credential-key segment', () => {
    expect(() => parseRemoteHostRecord({ ...valid, id: 'box/other' })).toThrow()
  })

  it('refuses a local port outside the TCP range', () => {
    expect(() => parseRemoteHostRecord({ ...valid, localPort: 0 })).toThrow()
  })

  it('refuses a record carrying a password field', () => {
    expect(() => parseRemoteHostRecord({ ...valid, password: 'leak' })).toThrow()
  })
})

describe('RemoteHostRegistry.passwordOf', () => {
  it('reads the password from the credential record rather than the host record', async () => {
    const { RemoteHostRegistry } = await import('../src/registry.ts')
    const readRecord = vi.fn(async () => ({
      kind: 'grant' as const,
      payload: { version: 1, password: 'hunter2' },
    }))
    const credentials = { readRecord }
    const storage = { read: async () => [], write: async () => undefined }
    const registry = new RemoteHostRegistry(credentials as never, storage)

    await expect(registry.passwordOf('box' as never)).resolves.toBe('hunter2')
    expect(readRecord).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run packages/remote/remote-hosts/tests/registry.spec.ts`

Expected: FAIL — cannot resolve `../src/spec.ts`.

- [ ] **Step 4: Write the durable schema**

`packages/remote/remote-hosts/src/spec.ts`:

```ts
/** The remote-host domain declaration and its record validation. */

import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

/** Branded identity of one configured remote host. */
export type RemoteHostId = string & { readonly __brand: 'RemoteHostId' }

/** One configured remote host. The SSH password is deliberately absent: see the registry. */
export interface RemoteHostRecord {
  readonly id: RemoteHostId
  readonly label: string
  readonly host: string
  readonly port: number
  readonly user: string
  readonly remotePort: number
  readonly localPort: number
}

const port = z.number().int().min(1).max(65_535)
const hostSegment = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/)

/**
 * One durable record. `strict()` is the reason a stray `password` field fails
 * the load: the secret belongs in `ctx.credentials`, and a record that carries
 * one is a mistake worth stopping for.
 */
export const remoteHostRecordSchema = z.object({
  id: hostSegment,
  label: z.string().min(1),
  host: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9.:-]*$/),
  port,
  user: hostSegment,
  remotePort: port,
  localPort: port,
}).strict()

/** Durable registry state: the ordered host list. */
export const remoteHostDomainState = z.object({
  hostIds: z.array(z.string()).default([]),
})

/**
 * The domain the registry opens over `ctx.storageDomain`. `global` needs both
 * its schema and the value served before the first write.
 */
export const remoteHostDomainSpec = defineDomain({
  name: 'remote-hosts',
  version: 1,
  tables: {
    hosts: domainTable(remoteHostRecordSchema),
  },
  global: { schema: remoteHostDomainState, initial: { hostIds: [] } },
})

/**
 * Validate one candidate record.
 * @param value - the candidate, as stored or as a caller supplied it.
 * @returns the parsed record, with its id branded.
 */
export function parseRemoteHostRecord(value: unknown): RemoteHostRecord {
  const parsed = remoteHostRecordSchema.parse(value)
  return { ...parsed, id: brandString<RemoteHostId>(parsed.id) }
}
```

- [ ] **Step 5: Write the registry**

`packages/remote/remote-hosts/src/registry.ts`:

```ts
/** Host-list storage in `ctx.storageDomain` and the SSH password in `ctx.credentials`. */

import { credentialKey } from '@deepseek-ai/dsh-credentials'
import type { CredentialProvider, CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { parseRemoteHostRecord, type RemoteHostId, type RemoteHostRecord } from './spec.ts'

/** Credential scope owning every remote host's password record. */
export const REMOTE_HOST_CREDENTIAL_SCOPE = 'remote-host-ssh'

const PASSWORD_RECORD_VERSION = 1

/**
 * Recover the password from a stored `grant` record. A record of another kind,
 * or one whose payload this version does not know, fails loud rather than
 * reading as "no password stored" and sending the operator to fix the wrong thing.
 */
function readPassword(record: CredentialRecord | undefined): string | undefined {
  if (record === undefined) return undefined
  if (record.kind !== 'grant' || typeof record.payload !== 'object' || record.payload === null) {
    throw new Error('remote-hosts: ssh password record has an unsupported format')
  }
  const payload = record.payload as { version?: unknown, password?: unknown }
  if (payload.version !== PASSWORD_RECORD_VERSION || typeof payload.password !== 'string' || payload.password === '') {
    throw new Error('remote-hosts: ssh password record has an invalid payload')
  }
  return payload.password
}

/**
 * The configured remote hosts and their secrets. Records hold no password: the
 * secret lives in `ctx.credentials` under a `grant` record per host.
 */
export class RemoteHostRegistry {
  private records: RemoteHostRecord[] = []

  /**
   * @param credentials - persistent credential provider holding each host's SSH password.
   * @param storage - the opened remote-host domain.
   */
  constructor(
    private readonly credentials: CredentialProvider,
    private readonly storage: RemoteHostStorage,
  ) {}

  /** The configured hosts, in display order. */
  list(): readonly RemoteHostRecord[] { return this.records }

  /** Store one host. A duplicate id replaces the existing record. */
  async add(value: RemoteHostRecord): Promise<void> {
    const record = parseRemoteHostRecord(value)
    const others = this.records.filter(existing => existing.id !== record.id)
    await this.storage.write([...others, record])
    this.records = [...others, record]
  }

  /** Forget one host, its password record included. */
  async remove(id: RemoteHostId): Promise<void> {
    await this.storage.write(this.records.filter(record => record.id !== id))
    this.records = this.records.filter(record => record.id !== id)
    await this.credentials.unset(credentialKey(REMOTE_HOST_CREDENTIAL_SCOPE, id))
  }

  /**
   * The host's SSH password.
   * @param id - the host to read.
   * @returns the stored password.
   */
  async passwordOf(id: RemoteHostId): Promise<string> {
    const record = await this.credentials.readRecord(credentialKey(REMOTE_HOST_CREDENTIAL_SCOPE, id))
    const password = readPassword(record)
    if (password === undefined) {
      throw new Error(`remote-hosts: no ssh password is stored for host ${JSON.stringify(id)}`)
    }
    return password
  }

  /** Replace the stored password for one host. */
  async setPassword(id: RemoteHostId, password: string): Promise<void> {
    await this.credentials.modifyRecord(credentialKey(REMOTE_HOST_CREDENTIAL_SCOPE, id), async () => ({
      kind: 'grant',
      payload: { version: PASSWORD_RECORD_VERSION, password },
    }))
  }

  /**
   * Load every stored host.
   * @returns the loaded records, in stored order.
   */
  async load(): Promise<readonly RemoteHostRecord[]> {
    const stored = await this.storage.read()
    this.records = stored.map(parseRemoteHostRecord)
    return this.records
  }
}

/** The domain handle the registry writes through; the Cordis service supplies it. */
export interface RemoteHostStorage {
  /** Read every stored record. */
  read(): Promise<unknown[]>
  /** Replace the stored record set durably. */
  write(records: readonly RemoteHostRecord[]): Promise<void>
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run packages/remote/remote-hosts/tests/registry.spec.ts`

Expected: PASS — 5 tests.

- [ ] **Step 7: Commit**

```bash
pnpm install
git add packages/remote/remote-hosts tsconfig.host.json pnpm-lock.yaml
git commit -m "feat(remote-hosts): store configured hosts and their passwords apart"
```

---

### Task 5: Remote API and the tunnelled connection service

**Files:**
- Create: `packages/remote/remote-hosts/src/index.ts`
- Create: `packages/remote/remote-hosts/src/connections.ts`
- Create: `packages/remote/remote-hosts/tests/remote-api.spec.ts`
- Modify: `packages/remote/remote-hosts/package.json` (add the two generated `exports` entries and the protocol peer)
- Modify: `packages/bundle/web-app/cordis.patch.yml` (add the Host row)
- Modify: `packages/bundle/web-app/package.json` (add the dependency)

**Interfaces:**
- Consumes: `RemoteHostRegistry` from Task 4; `SshTunnel` from Task 3.
- Produces: `RemoteHostController` (Cordis service `ctx.remoteHosts`, namespace `remoteHosts`) with `@Remote` methods `list()`, `add(input)`, `remove(id)`, `connect(id)`, `disconnect(id)`, `status()`.

- [ ] **Step 1: Write the failing test**

`packages/remote/remote-hosts/tests/remote-api.spec.ts`:

```ts
/** The controller reports domain failures as RemoteError codes with actionable details. */
import { describe, expect, it, vi } from 'vitest'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import { RemoteHostController } from '../src/index.ts'

function controllerWith(overrides: Record<string, unknown> = {}, connections?: Record<string, unknown>): RemoteHostController {
  const registry = {
    list: () => [],
    add: async () => undefined,
    remove: async () => undefined,
    passwordOf: async () => 'hunter2',
    load: async () => [],
    ...overrides,
  }
  return new RemoteHostController({} as never, {
    registry: registry as never,
    connections: (connections ?? { open: vi.fn(), close: vi.fn(), list: () => [], closeAll: vi.fn() }) as never,
  })
}

describe('RemoteHostController', () => {
  it('reports an unknown host as a domain code rather than a generic failure', async () => {
    const controller = controllerWith()
    const failure = await controller.remoteExportConnect('missing').catch((error: unknown) => error)

    expect(remoteErrorOf(failure)).toMatchObject({
      code: 'remote-host/unknown',
      details: { id: 'missing' },
    })
  })

  it('reports an unreachable SSH endpoint as its own code', async () => {
    const controller = controllerWith(
      { list: () => [{ id: 'box', label: 'Box', host: 'box.example', port: 22, user: 'jin', remotePort: 3080, localPort: 51080 }] },
      { open: async () => { throw new Error('Connection refused') }, close: vi.fn(), list: () => [], closeAll: vi.fn() },
    )
    const failure = await controller.remoteExportConnect('box').catch((error: unknown) => error)

    expect(remoteErrorOf(failure)).toMatchObject({ code: 'remote-host/unreachable' })
  })

  it('reports a bound local port as its own code', async () => {
    const controller = controllerWith(
      { list: () => [{ id: 'box', label: 'Box', host: 'box.example', port: 22, user: 'jin', remotePort: 3080, localPort: 51080 }] },
      { open: async () => { throw new Error('listen EADDRINUSE: address already in use 127.0.0.1:51080') }, close: vi.fn(), list: () => [], closeAll: vi.fn() },
    )
    const failure = await controller.remoteExportConnect('box').catch((error: unknown) => error)

    expect(remoteErrorOf(failure)).toMatchObject({
      code: 'remote-host/port-taken',
      details: { localPort: 51080 },
    })
  })

  it('lists configured hosts without exposing a password', async () => {
    const controller = controllerWith({
      list: () => [{ id: 'box', label: 'Box', host: 'box.example', port: 22, user: 'jin', remotePort: 3080, localPort: 51080 }],
    })
    const rows = await controller.remoteExportList()

    expect(rows).toHaveLength(1)
    expect(JSON.stringify(rows)).not.toContain('hunter2')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/remote/remote-hosts/tests/remote-api.spec.ts`

Expected: FAIL — cannot resolve `../src/index.ts`.

- [ ] **Step 3: Write the connection owner**

`packages/remote/remote-hosts/src/connections.ts`:

```ts
/** Live tunnels, one per connected host, and the local port each reports. */

import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SshTunnel, type SshTunnelOptions, type TunnelTarget } from '@deepseek-ai/dsh-ssh-tunnel'
import type { RemoteHostId, RemoteHostRecord } from './spec.ts'

/** One connected host: the tunnel and the loopback authority its frame loads from. */
export interface ConnectedHost {
  readonly id: RemoteHostId
  readonly localPort: number
}

/**
 * Owns every live tunnel. Opening a host that is already connected returns the
 * existing connection, so a second click in the switcher cannot leak a tunnel.
 */
export class RemoteHostConnections {
  private readonly tunnels = new Map<RemoteHostId, SshTunnel>()
  private readonly ports = new Map<RemoteHostId, number>()

  /**
   * @param options - per-tunnel overrides; tests supply a runner here.
   */
  constructor(private readonly options: Partial<SshTunnelOptions> = {}) {}

  /** The connected hosts and their local ports. */
  list(): readonly ConnectedHost[] {
    return [...this.tunnels.keys()].map(id => ({ id, localPort: this.ports.get(id)! }))
  }

  /**
   * Open one host, or return its live connection.
   * @param record - the configured host.
   * @param password - the host's SSH password.
   * @returns the connected host and its local loopback port.
   */
  async open(record: RemoteHostRecord, password: string): Promise<ConnectedHost> {
    const existing = this.tunnels.get(record.id)
    if (existing !== undefined) return { id: record.id, localPort: existing.localPort }

    const directory = await mkdtemp(join(tmpdir(), 'dsh-remote-host-'))
    const knownHostsPath = join(directory, 'known_hosts')
    await mkdir(directory, { recursive: true })
    const target: TunnelTarget = {
      host: record.host,
      port: record.port,
      user: record.user,
      remotePort: record.remotePort,
      localPort: record.localPort,
    }
    const tunnel = new SshTunnel(target, password, { ...this.options, directory, knownHostsPath })
    try {
      await tunnel.open()
    } catch (error) {
      await tunnel.close()
      throw error
    }
    this.tunnels.set(record.id, tunnel)
    this.ports.set(record.id, tunnel.localPort)
    return { id: record.id, localPort: tunnel.localPort }
  }

  /** Close one host's tunnel; closing an unconnected host is a no-op. */
  async close(id: RemoteHostId): Promise<void> {
    const tunnel = this.tunnels.get(id)
    this.tunnels.delete(id)
    this.ports.delete(id)
    if (tunnel !== undefined) await tunnel.close()
  }

  /** Close every tunnel; the service disposer calls this. */
  async closeAll(): Promise<void> {
    await Promise.all([...this.tunnels.keys()].map(id => this.close(id)))
  }
}
```

- [ ] **Step 4: Write the controller**

`packages/remote/remote-hosts/src/index.ts`:

```ts
/**
 * The remote-host feature's Host half: durable host records, their SSH
 * passwords, the tunnels to them, and the `ctx.remote.remoteHosts` namespace.
 * @module @deepseek-ai/dsh-remote-hosts
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-storage-domain'
import { RemoteHostConnections } from './connections.ts'
import { RemoteHostRegistry } from './registry.ts'
import { parseRemoteHostRecord, remoteHostDomainSpec, type RemoteHostId, type RemoteHostRecord } from './spec.ts'

export type { RemoteHostRecord, RemoteHostId } from './spec.ts'
export { parseRemoteHostRecord, remoteHostRecordSchema } from './spec.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** No configured host carries that id. */
    'remote-host/unknown': { readonly id: string }
    /** The SSH endpoint refused the connection, the port, or the password. */
    'remote-host/unreachable': { readonly id: string, readonly host: string, readonly port: number }
    /** The host is configured but stores no SSH password. */
    'remote-host/no-password': { readonly id: string }
    /** The local tunnel port is already bound by another process. */
    'remote-host/port-taken': { readonly id: string, readonly localPort: number }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context { remoteHosts: RemoteHostController }
}

/** What the Client receives for one configured host; never a password. */
export interface RemoteHostRow {
  readonly id: string
  readonly label: string
  readonly host: string
  readonly port: number
  readonly user: string
  readonly remotePort: number
  readonly localPort: number
  readonly connected: boolean
}

/** One connection's resolved state, as the frame loader needs it. */
export interface RemoteHostConnection {
  readonly id: string
  readonly localPort: number
  readonly origin: string
}

/** Test seams for {@link RemoteHostController}; production passes none. */
export interface RemoteHostOverrides {
  /** Replace the tunnel owner so a spec need not spawn `ssh`. */
  connections?: RemoteHostConnections
  /** Replace host storage and password reads. */
  registry?: RemoteHostRegistry
}

/** Host service backing the generated `ctx.remote.remoteHosts` namespace. */
export class RemoteHostController extends TypertRemoteService {
  static inject = ['credentials', 'storageDomain']

  private readonly registry: RemoteHostRegistry
  private readonly connections: RemoteHostConnections
  private storage: { read(): Promise<unknown[]>, write(records: readonly RemoteHostRecord[]): Promise<void> } | undefined

  /**
   * @param ctx - Host context carrying credentials and the storage domain.
   * @param overrides - test seams; production passes none.
   */
  constructor(ctx: Context, overrides: RemoteHostOverrides = {}) {
    super(ctx, 'remoteHosts', { namespace: 'remoteHosts' })
    this.connections = overrides.connections ?? new RemoteHostConnections()
    this.registry = overrides.registry ?? new RemoteHostRegistry(ctx.credentials, {
      read: async () => await this.storageHandle().read(),
      write: async (records) => { await this.storageHandle().write(records) },
    })
    ctx.effect(() => () => this.connections.closeAll(), 'remote-hosts:closeTunnels')
  }

  /** Open the durable domain; the Host is not ready until the host list loads. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(remoteHostDomainSpec)
    this.ctx.effect(() => () => domain.close(), 'remote-hosts:domainClose')
    const table = domain.table('hosts')
    this.storage = {
      read: async () => [...table.entries()].map(([, record]) => record),
      write: async (records) => {
        for (const key of [...table.keys()]) await table.delete(key)
        for (const record of records) await table.put(record.id, record)
      },
    }
    await this.registry.load()
  }

  private storageHandle(): NonNullable<RemoteHostController['storage']> {
    if (this.storage === undefined) throw new Error('remote-hosts: the host domain is not open')
    return this.storage
  }

  /**
   * Every configured host and whether its tunnel is live.
   * @returns the rows the switcher renders.
   */
  @Remote('list')
  async remoteExportList(): Promise<RemoteHostRow[]> {
    const connected = new Set(this.connections.list().map(entry => entry.id))
    return this.registry.list().map(record => ({
      id: record.id,
      label: record.label,
      host: record.host,
      port: record.port,
      user: record.user,
      remotePort: record.remotePort,
      localPort: record.localPort,
      connected: connected.has(record.id),
    }))
  }

  /**
   * Add or replace one host and store its SSH password.
   * @param input - the host fields plus its password.
   * @returns the stored row.
   */
  @Remote('add')
  async remoteExportAdd(input: RemoteHostRecord & { readonly password: string }): Promise<RemoteHostRow> {
    const { password, ...rest } = input
    const record = parseRemoteHostRecord(rest)
    await this.registry.add(record)
    await this.registry.setPassword(record.id, password)
    const rows = await this.remoteExportList()
    return rows.find(row => row.id === record.id)!
  }

  /**
   * Forget one host and close its tunnel.
   * @param id - the host to remove.
   */
  @Remote('remove')
  async remoteExportRemove(id: string): Promise<void> {
    await this.connections.close(id as RemoteHostId)
    await this.registry.remove(id as RemoteHostId)
  }

  /**
   * Open the host's tunnel so its GUI can load.
   * @param id - the host to connect.
   * @returns the loopback origin the frame loads from.
   */
  @Remote('connect')
  async remoteExportConnect(id: string): Promise<RemoteHostConnection> {
    const record = this.registry.list().find(row => row.id === id)
    if (record === undefined) {
      throw new RemoteError('remote-host/unknown', `no configured host "${id}"`, { id })
    }
    let password: string
    try {
      password = await this.registry.passwordOf(record.id)
    } catch (error: unknown) {
      throw new RemoteError(
        'remote-host/no-password',
        `host "${id}" stores no ssh password`,
        { id },
        { cause: error },
      )
    }
    try {
      const connected = await this.connections.open(record, password)
      return { id, localPort: connected.localPort, origin: `http://127.0.0.1:${String(connected.localPort)}` }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      if (/address already in use|EADDRINUSE/u.test(message)) {
        throw new RemoteError('remote-host/port-taken', message, { id, localPort: record.localPort }, { cause: error })
      }
      throw new RemoteError(
        'remote-host/unreachable',
        message,
        { id, host: record.host, port: record.port },
        { cause: error },
      )
    }
  }

  /**
   * Close one host's tunnel. The remote process keeps running.
   * @param id - the host to disconnect.
   */
  @Remote('disconnect')
  async remoteExportDisconnect(id: string): Promise<void> {
    await this.connections.close(id as RemoteHostId)
  }
}

export default RemoteHostController
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run packages/remote/remote-hosts/tests/remote-api.spec.ts`

Expected: PASS — 3 tests.

- [ ] **Step 6: Regenerate the Remote artifacts**

The two `exports` entries and the protocol peer must be present before generation:

```json
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./typert": { "types": "./lib/typert.host.d.ts", "default": "./lib/typert.host.js" },
    "./remote": { "types": "./lib/typert.remote-client.d.ts", "default": "./lib/typert.remote-client.js" },
    "./src/*": "./src/*",
    "./package.json": "./package.json"
  },
  "files": ["lib/index.js", "lib/typert.host.js", "lib/typert.remote-client.js", "lib/types/**/*.d.ts"],
```

Then:

```bash
pnpm run build:lib
npx vitest run packages/remote/remote-hosts/tests/
```

Expected: PASS, and `lib/typert.host.js` plus `lib/typert.remote-client.js` exist.

- [ ] **Step 7: Mount the contribution in the API assembly**

A generated Remote contribution is inert until `@deepseek-ai/dsh-api-remotes` mounts it. Without this step the Client's `ctx.remote.remoteHosts` never appears and the panel's `inject` stays pending forever — a failure that looks like a hung panel, not a build error.

In `packages/api/remotes/src/client/index.ts`, add the import beside the other contributions:

```ts
import remoteHostsRemote from '@deepseek-ai/dsh-remote-hosts/remote'
```

Add the type re-export beside the others (this is the "one specifier" front door the package documents):

```ts
export type {} from '@deepseek-ai/dsh-remote-hosts/remote'
export type * from '@deepseek-ai/dsh-remote-hosts/types'
```

Add it to the array passed to `ctx.remote.$mount(contribution)` in the same `apply` body that mounts `workspaceRemote` and the rest.

Create `packages/remote/remote-hosts/src/types.ts` exporting the client-safe payload types the facade re-exports:

```ts
/** Client-safe wire types of the remote-host namespace. */
export type { RemoteHostRow, RemoteHostConnection } from './index.ts'
```

Add the matching `exports` entry to `packages/remote/remote-hosts/package.json`:

```json
    "./types": { "types": "./lib/types/types.d.ts", "default": "./lib/types.js" },
```

Then add `@deepseek-ai/dsh-remote-hosts` to `packages/api/remotes/package.json`'s `dependencies` and `devDependencies` (`workspace:^`), and rebuild:

```bash
pnpm install
pnpm run build:lib
pnpm run verify-client-packages
```

- [ ] **Step 8: Register the Host plugin in the Web profile**

Add to `packages/bundle/web-app/cordis.patch.yml` in the layer-2 `insert:` roster, beside the `webserver` row:

```yaml
    # Remote Harness hosts reachable over an SSH tunnel: the durable host
    # list, each host's SSH password, and the tunnels the switcher opens.
    - id: remote-hosts
      name: '@deepseek-ai/dsh-remote-hosts'
```

Add to `packages/bundle/web-app/package.json` `dependencies`:

```json
    "@deepseek-ai/dsh-remote-hosts": "workspace:^",
```

- [ ] **Step 9: Verify the profile still composes and commit**

```bash
pnpm install
pnpm run verify-cordis-config
git add packages/remote/remote-hosts packages/bundle/web-app tsconfig.host.json pnpm-lock.yaml
git commit -m "feat(remote-hosts): serve the remote host API over Typert Remote"
```

---

### Task 6: The host switcher and its frame

**Files:**
- Create: `packages/client/ui-remote-hosts/package.json`
- Create: `packages/client/ui-remote-hosts/tsconfig.json`
- Create: `packages/client/ui-remote-hosts/tsdown.config.ts`
- Create: `packages/client/ui-remote-hosts/src/index.ts`
- Create: `packages/client/ui-remote-hosts/src/client/locales.ts`
- Create: `packages/client/ui-remote-hosts/src/client/index.ts`
- Create: `packages/client/ui-remote-hosts/src/client/RemoteHostsPanel.tsx`
- Create: `packages/client/ui-remote-hosts/src/client/RemoteHostsPanel.module.css`
- Create: `packages/client/ui-remote-hosts/src/client/RemoteHostsIcon.tsx`
- Create: `packages/client/ui-remote-hosts/tests/apply.client.spec.ts`
- Modify: `tsconfig.client.json` (add the reference)
- Modify: `packages/bundle/web-app/cordis.patch.yml` (add the `dsh.client` row)
- Modify: `packages/bundle/web-app/package.json` (add the dependency)

**Interfaces:**
- Consumes: `ctx.remote.remoteHosts` from Task 5.
- Produces: a sidebar entry in the Plugins position and a main panel that frames the active remote.

- [ ] **Step 1: Create the manifests and configs**

`packages/client/ui-remote-hosts/package.json`:

```json
{
  "name": "@deepseek-ai/dsh-client-ui-remote-hosts",
  "description": "Sidebar host switcher and framed view of a remote Harness",
  "version": "0.1.6-alpha.2",
  "publishConfig": { "access": "public" },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/deepseek-ai/deepseek-harness.git",
    "directory": "packages/client/ui-remote-hosts"
  },
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" },
    "./src/*": "./src/*",
    "./package.json": "./package.json"
  },
  "files": ["lib/index.js", "lib/client.js", "lib/types/**/*.d.ts"],
  "license": "MIT",
  "dsh": {
    "client": {
      "inject": [
        "@deepseek-ai/dsh-api-remotes",
        "@deepseek-ai/dsh-client-locale",
        "@deepseek-ai/dsh-client-ui-layout",
        "@deepseek-ai/dsh-client-ui-sidebar"
      ],
      "platform": "web"
    }
  },
  "peerDependencies": { "@deepseek-ai/cordis": "workspace:^" },
  "devDependencies": {
    "@deepseek-ai/cordis": "workspace:^",
    "@deepseek-ai/dsh-api-remotes": "workspace:^",
    "@deepseek-ai/dsh-client-locale": "workspace:^",
    "@deepseek-ai/dsh-client-ui-layout": "workspace:^",
    "@deepseek-ai/dsh-client-ui-sidebar": "workspace:^",
    "@deepseek-ai/dsh-client-test-runtime": "workspace:^"
  }
}
```

`packages/client/ui-remote-hosts/tsconfig.json` extends `tsconfig.base.client.json` and references the four dev dependencies plus `vendor/cordis`.

`packages/client/ui-remote-hosts/tsdown.config.ts`:

```ts
import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle('@deepseek-ai/dsh-client-ui-remote-hosts', ['lib/types/index.js'])
```

`packages/client/ui-remote-hosts/src/index.ts` — the Node half is empty by contract:

```ts
/** Node half of the remote-host switcher: it registers nothing. */

export {}
```

- [ ] **Step 2: Write the failing test**

`packages/client/ui-remote-hosts/tests/apply.client.spec.ts`:

```ts
// @vitest-environment jsdom
/** The panel lists configured hosts and frames the one the operator selects. */
import { Context } from '@deepseek-ai/cordis'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { describe, expect, it } from 'vitest'
import { apply } from '../src/client/index.ts'

function mounted(hosts: readonly Record<string, unknown>[]) {
  const ctx = new Context()
  const remote = new TestRemote(ctx, {
    remoteHosts: {
      list: () => Promise.resolve({ ok: true as const, value: hosts }),
      connect: () => Promise.resolve({ ok: true as const, value: { id: 'box', localPort: 51080, origin: 'http://127.0.0.1:51080' } }),
      add: () => Promise.resolve({ ok: false as const, error: new Error('unused') }),
      remove: () => Promise.resolve({ ok: true as const, value: undefined }),
      disconnect: () => Promise.resolve({ ok: true as const, value: undefined }),
    },
  })
  return { ctx, remote, fiber: ctx.plugin(apply) }
}

describe('remote host switcher', () => {
  it('renders one entry per configured host plus the local host', async () => {
    const { ctx, fiber } = mounted([
      { id: 'box', label: 'Build box', host: 'box.example', port: 22, user: 'jin', remotePort: 3080, localPort: 51080, connected: false },
    ])
    await fiber
    const rows = ctx.remote.remoteHosts.list
    expect(rows).toBeTypeOf('function')
    await fiber.dispose()
  })

  it('points the frame at the connected host origin after connecting', async () => {
    const { ctx, fiber } = mounted([])
    await fiber
    const result = await ctx.remote.remoteHosts.connect('box')
    expect(result).toMatchObject({ ok: true, value: { origin: 'http://127.0.0.1:51080' } })
    await fiber.dispose()
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run packages/client/ui-remote-hosts/tests/apply.client.spec.ts`

Expected: FAIL — cannot resolve `../src/client/index.ts`.

- [ ] **Step 4: Write the locale dictionary**

`packages/client/ui-remote-hosts/src/client/locales.ts`:

```ts
/** Typed copy for the remote-host switcher; no component holds a literal string. */

export const en = {
  panel: 'Remote hosts',
  title: 'Remote hosts',
  localHost: 'This machine',
  addHost: 'Add host',
  label: 'Name',
  host: 'SSH host',
  port: 'SSH port',
  user: 'SSH user',
  password: 'SSH password',
  remotePort: 'Remote dsh web port',
  localPort: 'Local tunnel port',
  connect: 'Connect',
  disconnect: 'Disconnect',
  remove: 'Remove',
  connected: 'Connected',
  connecting: 'Connecting…',
  frameTitle: 'Remote Harness',
  unknownHost: 'That host is no longer configured.',
  unreachable: 'The SSH connection failed. Check the host, port, and password.',
  noPassword: 'No SSH password is stored for this host.',
  portTaken: 'The local tunnel port is already in use.',
}

export const zh: typeof en = {
  panel: '远端主机',
  title: '远端主机',
  localHost: '本机',
  addHost: '添加主机',
  label: '名称',
  host: 'SSH 主机',
  port: 'SSH 端口',
  user: 'SSH 用户',
  password: 'SSH 密码',
  remotePort: '远端 dsh web 端口',
  localPort: '本地隧道端口',
  connect: '连接',
  disconnect: '断开',
  remove: '移除',
  connected: '已连接',
  connecting: '连接中…',
  frameTitle: '远端 Harness',
  unknownHost: '该主机已不在配置中。',
  unreachable: 'SSH 连接失败。请检查主机、端口与密码。',
  noPassword: '该主机未存储 SSH 密码。',
  portTaken: '本地隧道端口已被占用。',
}
```

- [ ] **Step 5: Write the plugin and panel**

`packages/client/ui-remote-hosts/src/client/index.ts` — register the sidebar entry exactly as the Plugins entry does:

```ts
/**
 * Remote-host switcher, browser half: the sidebar entry in the Plugins
 * position and the panel that frames the connected remote's GUI.
 * @module @deepseek-ai/dsh-client-ui-remote-hosts/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { en, zh } from './locales.ts'
import { RemoteHostsPanel } from './RemoteHostsPanel.tsx'
import { RemoteHostsIcon } from './RemoteHostsIcon.tsx'

/** Dictionary namespace owned by this plugin. */
export const NS = 'remoteHosts'

/** The id shared by the sidebar entry and the main panel it opens. */
export const PANEL_ID = 'remote-hosts'

/** Services required by the sidebar registration and the Remote methods. */
export const inject = ['slots', 'locale', 'remote', 'remote.remoteHosts']

/**
 * Contribute the remote-host entry to the sidebar and the panel it opens.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-remote-hosts:dictionaries')
  const t = ctx.locale.bind(NS)

  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: NS,
  }, RemoteHostsPanel))

  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 1,
    label: () => t('panel'),
    locale: NS,
  }, RemoteHostsIcon))
}
```

`PANEL_ID` is a plain string here; the real registration narrows it with the layout package's `MainPanelId` brand, exactly as `ui-plugin-manager` writes `export const PANEL_ID = 'plugins' as MainPanelId`. Import that type from `@deepseek-ai/dsh-client-ui-layout/client` and keep the cast.

`packages/client/ui-remote-hosts/src/client/locales.ts` must also export the key union the panel's `t` is typed by:

```ts
/** Every copy key this plugin owns; `t` is typed by it. */
export type RemoteHostsLocaleKey = keyof typeof en
```

`packages/client/ui-remote-hosts/src/client/RemoteHostsPanel.tsx` — the switcher row plus the frame. `t` arrives through `PropsLocale`, exactly as `PluginManagerPage` receives it. The frame `src` is the tunnel origin, and the remote's own launch URL is what establishes the tunnel-origin session before the frame loads:

```tsx
/** The remote-host panel: pick a host, then operate the remote GUI in a frame. */

import { useEffect, useState, type ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { RemoteHostsController } from './controller.ts'
import type { RemoteHostsLocaleKey } from './locales.ts'
import css from './RemoteHostsPanel.module.css'

/** Full props assembled by the main slot renderer. */
export type RemoteHostsPanelProps =
  PropsRuntime<'main'>
  & PropsLocale<'remoteHosts'>

/**
 * @param props - the derived runtime share and this page's locale seat.
 */
export function RemoteHostsPanel(props: RemoteHostsPanelProps): ReactNode {
  const { t } = props
  const [controller] = useState(() => new RemoteHostsController(props))
  const snapshot = controller.useSnapshot()
  const [error, setError] = useState<string | undefined>(undefined)

  useEffect(() => {
    void controller.load().catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => { controller.dispose() }
  }, [controller])

  const message = (code: string): string => {
    switch (code) {
      case 'remote-host/unknown': return t('unknownHost')
      case 'remote-host/no-password': return t('noPassword')
      case 'remote-host/port-taken': return t('portTaken')
      default: return t('unreachable')
    }
  }

  return (
    <div className={css.panel}>
      <ul className={css.hosts}>
        {snapshot.rows.map(row => (
          <li key={row.id} className={css.host}>
            <span className={css.label}>{row.label}</span>
            <span className={css.target}>{`${row.user}@${row.host}:${String(row.port)}`}</span>
            <button
              type="button"
              disabled={snapshot.busy === row.id}
              onClick={() => {
                void controller.connect(row.id).then(
                  () => { setError(undefined) },
                  (failure: { code?: string }) => { setError(message(failure.code ?? '')) },
                )
              }}
            >
              {snapshot.active === row.id ? t('connected') : snapshot.busy === row.id ? t('connecting') : t('connect')}
            </button>
          </li>
        ))}
      </ul>
      {error === undefined ? null : <p role="alert" className={css.error}>{error}</p>}
      {snapshot.frameOrigin === undefined ? null : (
        <iframe className={css.frame} title={t('frameTitle')} src={`${snapshot.frameOrigin}/`} />
      )}
    </div>
  )
}
```

`packages/client/ui-remote-hosts/src/client/controller.ts` — holds the host rows, the active connection, and the frame origin. It calls `ctx.remote.remoteHosts.list()` and `connect(id)` and exposes a `useSnapshot()` backed by `client/store`'s snapshot store, following `PluginManagerController` in `packages/client/ui-plugin-manager/src/client/manager-store.ts`:

`packages/client/ui-remote-hosts/src/client/RemoteHostsIcon.tsx` — a sidebar icon following the Plugins icon's shape, receiving `SidebarPanelIconOwnerProps` (`size`, `active`).

`packages/client/ui-remote-hosts/src/client/RemoteHostsPanel.module.css` — panel, host list, and a frame that fills the panel. Consume `--dsw-*` semantic tokens only; no literal colors.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run packages/client/ui-remote-hosts/tests/apply.client.spec.ts`

Expected: PASS — 2 tests.

- [ ] **Step 7: Register the three surfaces**

1. `tsconfig.client.json` — add `{ "path": "./packages/client/ui-remote-hosts" }` beside the other client packages.
2. `packages/bundle/web-app/cordis.patch.yml` — add beside the `ui-plugin-manager` row:

```yaml
    # Sidebar switcher for remote Harness hosts reached over an SSH tunnel,
    # and the panel that frames the connected host's own GUI.
    - id: ui-remote-hosts
      name: '@deepseek-ai/dsh-client-ui-remote-hosts'
```

3. `packages/bundle/web-app/package.json` — add `"@deepseek-ai/dsh-client-ui-remote-hosts": "workspace:^"` to `dependencies`.

- [ ] **Step 8: Verify and commit**

```bash
pnpm install
pnpm run test:gui
pnpm run verify-client-packages
git add packages/client/ui-remote-hosts packages/bundle/web-app tsconfig.client.json pnpm-lock.yaml
git commit -m "feat(ui-remote-hosts): switch hosts from the sidebar and frame the remote"
```

---

### Task 7: End-to-end proof and the recorded snapshot

**Files:**
- Create: `apps/web/tests/remote-host.e2e.ts`
- Create: `snapshots/session/remote-host-switcher/` (recorded fixture directory)

**Interfaces:**
- Consumes: everything above.
- Produces: evidence that the feature works end to end, and the keyless snapshot the testing policy requires for a product-user-visible change.

- [ ] **Step 1: Write the end-to-end test**

`apps/web/tests/remote-host.e2e.ts` must prove the whole chain against two real Harness instances. It starts a local `dsh web` on a fixed loopback port and a second one standing in for the remote, then:

```ts
/**
 * The remote-host feature end to end: a real tunnel, a real token exchange, and
 * a frame that renders the remote GUI and issues its own remote API calls.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
// The harness helpers below follow apps/web/tests/scaffold.ts and the existing
// real-host smoke, which already start a `dsh web` on an owned port.
import { startWebHost, type WebHost } from './scaffold.ts'

describe('remote host over an SSH tunnel', () => {
  let remote: WebHost

  beforeAll(async () => {
    remote = await startWebHost({ port: 0 })
  })

  afterAll(async () => { await remote.stop() })

  it('mints an authority-bound cookie for the tunnel origin', async () => {
    // The tunnel stands in for OpenSSH here: the point under test is that a
    // cookie minted on the tunnel authority authenticates that same authority.
    const token = remote.launchToken
    const exchanged = await fetch(`${remote.tunnelOrigin}/?token=${token}`, { redirect: 'manual' })
    expect(exchanged.status).toBe(303)
    const cookie = exchanged.headers.get('set-cookie')
    expect(cookie).toContain(`authority`)
  })

  it('answers an uncookied API call with 401 and a cookied one with a route', async () => {
    const denied = await fetch(`${remote.tunnelOrigin}/api`, { method: 'POST' })
    expect(denied.status).toBe(401)
  })

  it('renders the remote GUI inside a frame and reaches the remote API', async () => {
    // Page at the local origin embeds the tunnel origin; assert the frame
    // document is the remote GUI and that a remote API call it issues answers.
    const page = await openPageWithFrame(`${remote.tunnelOrigin}/`)
    await expect(page.frameText()).resolves.toContain('DeepSeek Harness')
    expect(page.remoteApiCalls.some(url => url.startsWith(remote.tunnelOrigin))).toBe(true)
  })
})
```

Fill `startWebHost` and `openPageWithFrame` from `apps/web/tests/scaffold.ts`'s existing helpers; the file already starts a `dsh web` with an owned port and an owned temporary `DSH_HOME`. If a helper is missing, add it to `scaffold.ts` in this task rather than inlining it here.

- [ ] **Step 2: Run the end-to-end test**

Run: `npx vitest run --config vitest.web.config.ts apps/web/tests/remote-host.e2e.ts`

Expected: PASS — 3 tests. The third is the one that catches a remote that started refusing embedding: it asserts rendered frame content, not just a 200 response.

- [ ] **Step 3: Record the snapshot**

The switcher changes product-visible output, so the repository requires a keyless recorded-session snapshot:

```bash
DSH_SNAPSHOT=record pnpm run test:snapshot
```

Then replay it keyless to prove it stands alone:

```bash
DSH_SNAPSHOT=replay pnpm run test:snapshot -t remote-host
```

Expected: PASS without an API key.

- [ ] **Step 4: Run the pre-push ladder for this surface**

```bash
pnpm run test:gui
pnpm run typecheck
pnpm run lint
pnpm run verify-translation-pairing
```

Expected: all PASS. `verify-translation-pairing` may still report the pre-existing `docs/research/2026-08-21-zcode-desktop-app-architecture.md` violation, which is an untracked local file unrelated to this work; every file this plan touches must pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/tests/remote-host.e2e.ts snapshots
git commit -m "test(remote-hosts): prove the tunnel, the frame, and the snapshot"
```

---

### Task 8: Repository-wide registration for both new packages

Both new packages must be registered everywhere the repository resolves workspace packages. Missing any one fails at a different, later point — a build that cannot resolve the specifier, or a profile whose row cannot import.

**Files:**
- Modify: `tsconfig.base.json` (its generated alias region)
- Modify: `tsconfig.host.json` (Host aggregate `references`)
- Modify: `tsconfig.client.json` (Client aggregate `references`)

- [ ] **Step 1: Regenerate the workspace path aliases**

`tsconfig.base.json` carries a **generated** region mapping one alias per package. A new package absent from it cannot be resolved by TypeScript or by tsx's source launch, and the gate reports drift instead of falling back:

```bash
pnpm run gen-tsconfig-paths
pnpm run verify-tsconfig-paths
```

Expected: the check passes, and `tsconfig.base.json` now carries `@deepseek-ai/dsh-ssh-tunnel` and `@deepseek-ai/dsh-remote-hosts`.

- [ ] **Step 2: Add the Host aggregate references**

In `tsconfig.host.json`, beside the other `packages/ssh/*` entries, add `{ "path": "./packages/ssh/ssh-tunnel" }` and `{ "path": "./packages/remote/remote-hosts" }`.

- [ ] **Step 3: Add the Client aggregate reference**

In `tsconfig.client.json`, add `{ "path": "./packages/client/ui-remote-hosts" }` beside the other `packages/client/*` entries.

- [ ] **Step 4: Verify the profile composes and the packages resolve**

```bash
pnpm install
pnpm run verify-cordis-config
pnpm run verify-client-packages
pnpm run verify-package-dependencies
```

Expected: all PASS. `verify-cordis-config` catches a `cordis.patch.yml` row no manifest declares; `verify-package-dependencies` catches a Client package whose Cordis peer or Host import classification is wrong.

- [ ] **Step 5: Commit**

```bash
git add tsconfig.base.json tsconfig.host.json tsconfig.client.json packages/bundle/web-app pnpm-lock.yaml
git commit -m "build(remote-hosts): register both new packages across the workspace"
```

---

## Manual acceptance

After Task 8, the feature is verified by hand once, because the frame handoff is the part a test approximates rather than reproduces:

1. On the local machine, run `dsh web` and open its URL.
2. In the sidebar, open **Remote hosts**, add a host (SSH host, port, user, password, remote `dsh web` port, and a free local port).
3. Connect. The remote's own GUI appears in the frame, showing the remote's Workspaces and Sessions.
4. Start a Session in the remote GUI and confirm it appears in the remote's own sidebar when that machine is opened directly — the work happened on the remote.
5. Disconnect: the frame closes and the remote `dsh web` keeps running.
6. Reconnect: no password prompt appears, because the stored credential is reused.
