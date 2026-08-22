import type { ChildProcess } from 'node:child_process'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api'
import { packagedExecutablePath } from '../scripts/desktop-target.mjs'

const APPLICATION_EXECUTABLE = process.env.DSH_DESKTOP_APPLICATION_PATH
  ?? packagedExecutablePath(fileURLToPath(new URL('../out/', import.meta.url)), `${process.platform}-${process.arch}`)
const packagedApplicationAvailable = existsSync(APPLICATION_EXECUTABLE)

/** Reserves an ephemeral loopback port for the Chromium CDP test attachment. */
function reserveLoopbackPort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      if (address === null || typeof address === 'string') {
        probe.close(() => { reject(new Error('desktop smoke port probe returned no TCP address')) })
        return
      }
      probe.close(() => { resolvePort(address.port) })
    })
  })
}

function collectOutput(child: ChildProcess): () => string {
  let output = ''
  const collect = (chunk: Buffer): void => { output += chunk.toString() }
  child.stdout?.on('data', collect)
  child.stderr?.on('data', collect)
  return () => output
}

function processExitDescription(child: ChildProcess): string | undefined {
  if (child.exitCode !== null) return `code ${String(child.exitCode)}`
  if (child.signalCode !== null) return `signal ${child.signalCode}`
  return undefined
}

async function waitForCdp(child: ChildProcess, port: number, output: () => string): Promise<void> {
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    const exit = processExitDescription(child)
    if (exit !== undefined) {
      throw new Error(`packaged DSH exited before opening CDP (${exit}):\n${output()}`)
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1_000) })
      if (response.ok) return
    } catch {
      // Chromium has not opened the test-only loopback CDP endpoint yet.
    }
    await new Promise((resolve) => { setTimeout(resolve, 100) })
  }
  throw new Error(`packaged DSH did not open CDP in 90s:\n${output()}`)
}

async function waitForDesktopPage(browser: Browser): Promise<Page> {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const desktopPage = browser.contexts()
      .flatMap(context => context.pages())
      .find(page => page.url().startsWith('dsh-app://renderer/'))
    if (desktopPage !== undefined) return desktopPage
    await new Promise((resolve) => { setTimeout(resolve, 100) })
  }
  throw new Error('packaged DSH did not create its renderer page within 60s')
}

async function waitForClose(child: ChildProcess, timeout: number): Promise<boolean> {
  if (processExitDescription(child) !== undefined) return true
  return await new Promise((resolveClose) => {
    const timer = setTimeout(() => { resolveClose(false) }, timeout)
    child.once('close', () => {
      clearTimeout(timer)
      resolveClose(true)
    })
  })
}

async function stopApplication(child: ChildProcess | undefined): Promise<void> {
  if (child === undefined || processExitDescription(child) !== undefined) return
  if (process.platform === 'win32') {
    // Electron child processes outlive the directly spawned executable on Windows.
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'])
    await waitForClose(child, 10_000)
    return
  }
  child.kill('SIGTERM')
  if (await waitForClose(child, 10_000)) return
  child.kill('SIGKILL')
  await waitForClose(child, 10_000)
}

describe.skipIf(!packagedApplicationAvailable)('packaged desktop smoke', () => {
  let browser: Browser | undefined
  let child: ChildProcess | undefined
  let page: Page
  let temporaryRoot: string

  beforeAll(async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), 'dsh-desktop-packaged-'))
    const port = await reserveLoopbackPort()
    child = spawn(APPLICATION_EXECUTABLE, [
      '--remote-debugging-address=127.0.0.1',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${join(temporaryRoot, 'chromium')}`,
    ], {
      cwd: temporaryRoot,
      env: {
        ...process.env,
        DSH_HOME: join(temporaryRoot, '.dsh'),
        DSH_AGENTS_HOME: join(temporaryRoot, '.agents'),
        DSH_TELEMETRY_DISABLED: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const output = collectOutput(child)
    await waitForCdp(child, port, output)
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    page = await waitForDesktopPage(browser)
  }, 180_000)

  afterAll(async () => {
    await browser?.close().catch(() => {})
    await stopApplication(child)
    if (temporaryRoot !== undefined) await rm(temporaryRoot, { recursive: true, force: true })
  }, 30_000)

  it('boots the packaged renderer and its fixed desktop bridge', async () => {
    await page.waitForFunction(() => window.__DSH_DESKTOP__ !== undefined && document.body.innerText !== '', undefined, { timeout: 30_000 })
    expect(await page.evaluate(() => ({
      bridge: Object.keys(window.__DSH_DESKTOP__ ?? {}).sort(),
      rawIpcExposed: Reflect.has(window, 'ipcRenderer'),
      requireType: typeof window.require,
    }))).toEqual({
      bridge: ['cancel', 'getWindowState', 'request', 'sendCommand', 'setWindowState', 'subscribe'],
      rawIpcExposed: false,
      requireType: 'undefined',
    })
  })

  it('serves an embedded runtime request after packaged boot', async () => {
    const response = await page.evaluate(async () => {
      const bridge = window.__DSH_DESKTOP__
      if (bridge === undefined) throw new Error('desktop bridge missing before packaged session request')
      return await bridge.request({
        type: 'client-request',
        rpcId: 'packaged-session-list' as RpcId,
        method: 'session.list',
        payload: {},
      })
    })
    expect(response).toMatchObject({ type: 'server-response', result: { ok: true } })
  })

  it('creates a session composed from the shipped standard preset', async () => {
    const response = await page.evaluate(async () => {
      const bridge = window.__DSH_DESKTOP__
      if (bridge === undefined) throw new Error('desktop bridge missing before packaged session creation')
      return await bridge.request({
        type: 'client-request',
        rpcId: 'packaged-session-create' as RpcId,
        method: 'session.create',
        payload: {},
      })
    })
    expect(response).toMatchObject({
      type: 'server-response',
      result: { ok: true, value: { agentPreset: 'standard' } },
    })
  })
})
