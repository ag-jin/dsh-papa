import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { bootDesktopRuntime } from '../src/desktop-boot.ts'

describe('desktop runtime boot', () => {
  it('disables hmr in the desktop bundle patch', () => {
    const patch = readFileSync(resolve(import.meta.dirname, '../../../packages/bundle/desktop-app/cordis.patch.yml'), 'utf8')
    expect(patch).toContain('- id: hmr')
    expect(patch).toContain('  disabled: true')
  })

  it('resolves bare patch entry packages from the desktop application root', async () => {
    const context = { fiber: { dispose: vi.fn(async () => {}) }, get: vi.fn((name: string) => name === 'desktopRuntime' ? {} : name === 'clientModules' ? { catalog: () => ({}) } : undefined) }
    const boot = vi.fn(async () => context)
    const resolveModule = vi.fn(() => '/app/node_modules/@deepseek-ai/dsh-client-ui-sidebar/lib/index.js')

    await bootDesktopRuntime({
      configPath: '/app/config/cordis.yml',
      packageAnchor: '/app/package.json',
      packageRoot: '/app',
      packageRootUrl: 'file:///app/',
      presetRoot: '/app/config/agent-presets',
    }, {
      boot,
      resolveBundleDir: vi.fn(() => '/bundles/base'),
      loadOverlayPatches: vi.fn(() => [{ insert: [{ id: 'ui-sidebar', name: '@deepseek-ai/dsh-client-ui-sidebar' }] }]),
      resolveModule,
    })

    expect(resolveModule).toHaveBeenCalledWith('/app/package.json', '@deepseek-ai/dsh-client-ui-sidebar')
    expect(boot).toHaveBeenCalledWith('dsh-desktop', '/app/config/cordis.yml', expect.arrayContaining([
      expect.objectContaining({ insert: [expect.objectContaining({ name: '/app/node_modules/@deepseek-ai/dsh-client-ui-sidebar/lib/index.js' })] }),
    ]), expect.any(Function), 'file:///app/')
  })

  it('boots only base and desktop patches with a shipped system preset root', async () => {
    const dispose = vi.fn(async () => {})
    const runtime = {}
    const catalog = {}
    const context = {
      fiber: { dispose },
      get: vi.fn((name: string) => name === 'desktopRuntime' ? runtime : name === 'clientModules' ? { catalog: () => catalog } : undefined),
    }
    const resolveBundleDir = vi.fn((_name: string, packageName: string, _installAnchor: string, _packageRoot: string) => '/bundles/' + packageName)
    const loadOverlayPatches = vi.fn((_name: string, path: string) => [{ id: path }])
    const boot = vi.fn(async () => context)

    const result = await bootDesktopRuntime({
      configPath: '/app/config/cordis.yml',
      packageAnchor: '/app/package.json',
      packageRoot: '/app',
      packageRootUrl: 'file:///app/',
      presetRoot: '/app/config/agent-presets',
    }, { boot, resolveBundleDir, loadOverlayPatches, resolveModule: vi.fn() })

    expect(resolveBundleDir.mock.calls.map(call => call[3])).toEqual(['/app', '/app'])
    expect(loadOverlayPatches.mock.calls.map(call => call[1])).toEqual([
      '/bundles/@deepseek-ai/dsh-base/cordis.patch.yml',
      '/bundles/@deepseek-ai/dsh-desktop-app/cordis.patch.yml',
    ])
    const finalPresetPatch = { id: 'agent-presets', config: { default: 'standard', roots: [{ path: '/app/config/agent-presets', trust: 'system' }] } }
    expect(boot).toHaveBeenCalledWith('dsh-desktop', '/app/config/cordis.yml', expect.arrayContaining([
      finalPresetPatch,
    ]), expect.any(Function), 'file:///app/')
    type FirstBootCall = [
      unknown,
      unknown,
      Array<typeof finalPresetPatch>,
      (prepared: { plugin(plugin: unknown): unknown }) => void | Promise<void>,
    ]
    const firstBootCall = boot.mock.calls.at(0) as unknown as FirstBootCall | undefined
    expect(firstBootCall?.[2].at(-1)).toEqual(finalPresetPatch)
    const prepare = firstBootCall?.[3]
    if (prepare === undefined) throw new Error('desktop boot did not provide its prepare callback')
    const plugin = vi.fn()
    await prepare({ plugin })
    expect(plugin).toHaveBeenCalledWith(InvariantRegistry)
    expect(result.runtime).toBe(runtime)
    expect(result.catalog).toBe(catalog)
    await result.dispose()
    expect(dispose).toHaveBeenCalledOnce()
  })
})
