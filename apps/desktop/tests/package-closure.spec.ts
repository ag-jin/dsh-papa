import { existsSync, lstatSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { copyApplicationForDiskImage, createDarwinDiskImage } from '../scripts/make-macos-dmg.mjs'
import { materializeProductionClosure } from '../scripts/stage-desktop.mjs'
import { verifyMaterializedApplication } from '../scripts/verify-desktop-artifacts.mjs'

interface PackageManifest {
  dependencies?: Record<string, string>
}

interface ForgeConfig {
  packagerConfig: {
    osxSign: {
      optionsForFile(path: string): { entitlements?: string[] }
    }
  }
  makers: Array<{
    name: string
    config: object
    platforms: string[]
  }>
}

const require = createRequire(import.meta.url)

async function manifest(path: string): Promise<PackageManifest> {
  return JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8')) as PackageManifest
}

describe('desktop packaged dependency closure', () => {
  it('disables library validation for every Electron application process', () => {
    const config = require('../forge.config.cjs') as ForgeConfig
    const optionsForFile = (path: string) => config.packagerConfig.osxSign.optionsForFile(path)
    const processEntitlements = [
      'com.apple.security.cs.allow-jit',
      'com.apple.security.cs.disable-library-validation',
    ]
    const pluginEntitlements = [
      'com.apple.security.cs.disable-library-validation',
      'com.apple.security.cs.allow-unsigned-executable-memory',
    ]

    expect(optionsForFile('/stage/DSH.app')).toEqual({ entitlements: processEntitlements })
    expect(optionsForFile('/stage/DSH.app/Contents/Frameworks/DSH Helper.app')).toEqual({ entitlements: processEntitlements })
    expect(optionsForFile('/stage/DSH.app/Contents/Frameworks/DSH Helper (Plugin).app')).toEqual({ entitlements: pluginEntitlements })
    expect(optionsForFile('/stage/DSH.app/Contents/Frameworks/Electron Framework.framework')).toEqual({})
  })

  it('declares the versioned ZIP maker only for Windows targets', () => {
    const config = require('../forge.config.cjs') as ForgeConfig

    expect(config.makers).toEqual([{ name: '@electron-forge/maker-zip', config: {}, platforms: ['win32'] }])
  })

  it('declares every base and desktop patch loader dependency at the application root', async () => {
    const [desktop, base, patch, cordis] = await Promise.all([
      manifest('../package.json'),
      manifest('../../../packages/bundle/base/package.json'),
      manifest('../../../packages/bundle/desktop-app/package.json'),
      manifest('../../../vendor/cordis/package.json'),
    ])
    const required = { ...base.dependencies, ...patch.dependencies, ...cordis.dependencies }

    expect(Object.keys(required).filter(name => desktop.dependencies?.[name] === undefined)).toEqual([])
    expect(desktop.dependencies?.['@deepseek-ai/dsh-invariants']).toBe('workspace:^')
    expect(desktop.dependencies?.['@deepseek-ai/cordis']).toBe('workspace:^')
    expect(desktop.dependencies?.['@deepseek-ai/cordis-plugin-include']).toBe('workspace:^')
    expect(desktop.dependencies?.['@deepseek-ai/cosmokit']).toBe('workspace:^')
    expect(desktop.dependencies?.['@standard-schema/spec']).toBe('^1.1.0')
  })

  it('declares every package named by the shipped standard preset', async () => {
    const [desktop, composition] = await Promise.all([
      manifest('../package.json'),
      readFile(new URL('../config/agent-presets/standard/agent.cordis.yml', import.meta.url), 'utf8'),
    ])
    const names = [...new Set([...composition.matchAll(/^\s*name:\s*'(@deepseek-ai\/[^'/]+)(?:\/[^']*)?'/gm)]
      .flatMap(match => match[1] === undefined ? [] : [match[1]]))]

    expect(names.filter(name => desktop.dependencies?.[name] === undefined)).toEqual([])
  })

  it('preserves Electron Framework relative links in the disk-image source bundle', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-dmg-links-'))
    const source = join(root, 'source', 'DSH.app')
    const destination = join(root, 'destination', 'DSH.app')
    const framework = join(source, 'Contents', 'Frameworks', 'Electron Framework.framework')
    try {
      await mkdir(join(framework, 'Versions', 'A'), { recursive: true })
      await writeFile(join(framework, 'Versions', 'A', 'Electron Framework'), '')
      await symlink('A', join(framework, 'Versions', 'Current'))
      await symlink(join('Versions', 'Current', 'Electron Framework'), join(framework, 'Electron Framework'))

      copyApplicationForDiskImage(source, destination)

      expect(await readlink(join(destination, 'Contents', 'Frameworks', 'Electron Framework.framework', 'Versions', 'Current'))).toBe('A')
      expect(await readlink(join(destination, 'Contents', 'Frameworks', 'Electron Framework.framework', 'Electron Framework')))
        .toBe(join('Versions', 'Current', 'Electron Framework'))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('retries a transient hdiutil resource-busy failure', async () => {
    const spawn = vi.fn()
      .mockReturnValueOnce({ status: 1, signal: null, stdout: '', stderr: 'hdiutil: create failed - Resource busy\n' })
      .mockReturnValueOnce({ status: 0, signal: null, stdout: 'created: output.dmg\n', stderr: '' })
    const remove = vi.fn()
    const wait = vi.fn().mockResolvedValue(undefined)

    await createDarwinDiskImage(['create', 'output.dmg'], '/workspace', spawn, remove, wait)

    expect(spawn).toHaveBeenCalledTimes(2)
    expect(remove).toHaveBeenCalledOnce()
    expect(remove).toHaveBeenCalledWith('output.dmg')
    expect(wait).toHaveBeenCalledOnce()
    expect(wait).toHaveBeenCalledWith(2_000)
  })

  it('fails immediately for a non-resource-busy hdiutil error', async () => {
    const spawn = vi.fn().mockReturnValue({ status: 1, signal: null, stdout: '', stderr: 'hdiutil: create failed - No space left on device\n' })
    const remove = vi.fn()
    const wait = vi.fn().mockResolvedValue(undefined)

    await expect(createDarwinDiskImage(['create', 'output.dmg'], '/workspace', spawn, remove, wait))
      .rejects.toThrow(/hdiutil create output\.dmg exited with 1/)
    expect(spawn).toHaveBeenCalledOnce()
    expect(remove).not.toHaveBeenCalled()
    expect(wait).not.toHaveBeenCalled()
  })

  it('fails after exhausting hdiutil resource-busy retries', async () => {
    const spawn = vi.fn().mockReturnValue({ status: 1, signal: null, stdout: '', stderr: 'hdiutil: create failed - Resource busy\n' })
    const remove = vi.fn()
    const wait = vi.fn().mockResolvedValue(undefined)

    await expect(createDarwinDiskImage(['create', 'output.dmg'], '/workspace', spawn, remove, wait))
      .rejects.toThrow(/hdiutil create output\.dmg exited with 1/)
    expect(spawn).toHaveBeenCalledTimes(3)
    expect(remove).toHaveBeenCalledTimes(2)
    expect(wait).toHaveBeenCalledTimes(2)
  })

  it('rejects an extracted Windows delivery directory with missing runtime resources', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-delivery-layout-'))
    try {
      await writeFile(join(root, 'DSH.exe'), '')

      expect(() => {
        verifyMaterializedApplication(
          { target: 'win32-x64', platform: 'win32', arch: 'x64' },
          root,
        )
      }).toThrow(/resources[\\/]app\.asar/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('materializes transitive production peers without development dependencies', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-closure-'))
    const source = join(root, 'source')
    const stage = join(root, 'stage')
    const writeManifest = async (directory: string, value: object) => {
      await mkdir(directory, { recursive: true })
      await writeFile(join(directory, 'package.json'), JSON.stringify(value))
    }

    try {
      await writeManifest(source, { dependencies: { parent: '1.0.0' } })
      await writeManifest(join(source, 'node_modules', 'parent'), {
        name: 'parent',
        version: '1.0.0',
        peerDependencies: { runtime: '1.0.0' },
        devDependencies: { development: '1.0.0' },
      })
      await writeManifest(join(source, 'node_modules', 'runtime'), { name: 'runtime', version: '1.0.0' })
      await writeManifest(join(source, 'node_modules', 'development'), { name: 'development', version: '1.0.0' })
      await mkdir(join(source, 'node_modules', 'parent', 'node_modules'), { recursive: true })
      await symlink(
        join(source, 'node_modules', 'runtime'),
        join(source, 'node_modules', 'parent', 'node_modules', 'runtime'),
      )
      await writeManifest(stage, { dependencies: { parent: '1.0.0' } })
      await writeManifest(join(stage, 'node_modules', 'parent'), {
        name: 'parent',
        version: '1.0.0',
        peerDependencies: { runtime: '1.0.0' },
        devDependencies: { development: '1.0.0' },
      })

      materializeProductionClosure(join(source, 'package.json'), stage)

      expect(existsSync(join(stage, 'node_modules', 'runtime', 'package.json'))).toBe(true)
      expect(lstatSync(join(stage, 'node_modules', 'runtime')).isSymbolicLink()).toBe(false)
      expect(existsSync(join(stage, 'node_modules', 'development'))).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
