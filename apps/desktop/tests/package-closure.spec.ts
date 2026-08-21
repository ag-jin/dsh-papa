import { existsSync, lstatSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { materializeProductionClosure } from '../scripts/stage-mac.mjs'

interface PackageManifest {
  dependencies?: Record<string, string>
}

async function manifest(path: string): Promise<PackageManifest> {
  return JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8')) as PackageManifest
}

describe('desktop packaged dependency closure', () => {
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
