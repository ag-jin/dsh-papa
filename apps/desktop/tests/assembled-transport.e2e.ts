// Real Electron acceptance lane for the packaged desktop transport.
// Exercises the built main process and bundled renderer through Playwright's
// Electron support, without starting dsh web, Vite, or any DSH web listener.
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api'

const DESKTOP_ROOT = fileURLToPath(new URL('..', import.meta.url))
const MAIN_ENTRY = fileURLToPath(new URL('../lib/electron-runner.js', import.meta.url))

describe('packaged desktop transport', () => {
  let app: ElectronApplication
  let page: Page
  let temp: string

  beforeAll(async () => {
    temp = await mkdtemp(join(tmpdir(), 'dsh-desktop-e2e-'))
  }, 60_000)

  afterAll(async () => {
    await app?.close().catch(() => {})
    await rm(temp, { recursive: true, force: true }).catch(() => {})
  })

  it('drives the packaged renderer through the desktop bridge', async () => {
    app = await electron.launch({
      args: [MAIN_ENTRY],
      cwd: DESKTOP_ROOT,
      env: {
        ...process.env,
        DSH_HOME: temp,
        DSH_AGENTS_HOME: join(temp, '.agents'),
        DSH_TELEMETRY_DISABLED: '1',
      },
      timeout: 120_000,
    })
    page = await app.firstWindow({ timeout: 60_000 })

    // Renderer readiness through the packaged application: the preload bridge
    // is installed and the packaged renderer executed its normal entry.
    await page.waitForFunction(() => window.__DSH_DESKTOP__ !== undefined && document.body.innerText !== '', undefined, { timeout: 30_000 })
    const bridge = page.evaluate(() => {
      const bridge = window.__DSH_DESKTOP__
      if (bridge === undefined) throw new Error('renderer readiness did not install the desktop bridge')
      return { keys: Object.keys(bridge).sort() }
    })
    expect(await bridge).toMatchObject({
      keys: ['cancel', 'getWindowState', 'request', 'sendCommand', 'setWindowState', 'subscribe'],
    })

    // A local session request through the IPC bridge with fixture-controlled tool output.
    const direct = await page.evaluate(async () => {
      const bridge = window.__DSH_DESKTOP__
      if (bridge === undefined) throw new Error('desktop bridge missing before request')
      return await bridge.request({
        type: 'client-request',
        rpcId: 'e2e-local-session' as RpcId,
        method: 'session.list',
        payload: {},
      })
    })
    expect(direct).toMatchObject({ type: 'server-response', result: { ok: true } })
  }, 180_000)

  it('reloads and reconnects to the application-scoped runtime', async () => {
    // The bridge is injected by preload again and the IPC authority sees a fresh
    // renderer sender while the embedded runtime remains the same main-process object.
    await page.reload({ waitUntil: 'load' })
    await page.waitForFunction(() => window.__DSH_DESKTOP__ !== undefined && document.body.innerText !== '', undefined, { timeout: 30_000 })
    const request = await page.evaluate(async () => {
      const bridge = window.__DSH_DESKTOP__
      if (bridge === undefined) throw new Error('desktop bridge missing after reload')
      return await bridge.request({ type: 'client-request', rpcId: 'e2e-reload' as RpcId, method: 'session.list', payload: {} })
    })
    expect(request).toMatchObject({ type: 'server-response', result: { ok: true } })
    expect(await page.evaluate(() => typeof window.require)).toBe('undefined')
  }, 120_000)

  it('exposes no undeclared bridge operation or raw IPC channel', async () => {
    const surface = await page.evaluate(() => {
      const bridge = window.__DSH_DESKTOP__
      if (bridge === undefined) throw new Error('desktop bridge missing before security assertion')
      return {
        keys: Object.keys(bridge).sort(),
        frozen: Object.isFrozen(bridge),
        rawIpcExposed: Reflect.has(window, 'ipcRenderer'),
        requireType: typeof window.require,
      }
    })
    expect(surface).toEqual({
      keys: ['cancel', 'getWindowState', 'request', 'sendCommand', 'setWindowState', 'subscribe'],
      frozen: true,
      rawIpcExposed: false,
      requireType: 'undefined',
    })
  }, 120_000)

  it('persists normalized desktop state in Electron user data before clean shutdown', async () => {
    const userData = await app.evaluate(({ app }) => app.getPath('userData'))
    await page.evaluate(async () => {
      const bridge = window.__DSH_DESKTOP__
      if (bridge === undefined) throw new Error('desktop bridge missing before shutdown')
      await bridge.setWindowState({ bounds: { width: 777, height: 555 } })
    })
    await app.close()
    expect(await readFile(join(userData, 'window-state.json'), 'utf8')).toContain('"width":777')
  }, 120_000)
})
