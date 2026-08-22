import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  packagedApplicationDirectory,
  packagedExecutablePath,
  parseTarget,
  requireNativeHost,
  requireSupportedHost,
  resolveTarget,
  SUPPORTED_TARGETS,
} from '../scripts/desktop-target.mjs'
import { resolvePackageManagerLaunch } from '../scripts/stage-desktop.mjs'

describe('desktop packaging targets', () => {
  it('declares the supported native targets explicitly', () => {
    expect(SUPPORTED_TARGETS).toEqual(['darwin-arm64', 'darwin-x64', 'win32-x64'])
  })

  it('parses supported targets into platform and architecture', () => {
    expect(parseTarget('darwin-arm64')).toEqual({ target: 'darwin-arm64', platform: 'darwin', arch: 'arm64' })
    expect(parseTarget('darwin-x64')).toEqual({ target: 'darwin-x64', platform: 'darwin', arch: 'x64' })
    expect(parseTarget('win32-x64')).toEqual({ target: 'win32-x64', platform: 'win32', arch: 'x64' })
  })

  it('rejects unsupported and malformed targets', () => {
    for (const raw of ['linux-x64', 'darwin-ia32', 'darwin', 'win32', '-x64', '']) {
      expect(() => parseTarget(raw)).toThrow(/supported targets are darwin-arm64, darwin-x64, win32-x64/)
    }
  })

  it('defaults each target half to the host', () => {
    expect(resolveTarget({})).toEqual({
      target: `${process.platform}-${process.arch}`,
      platform: process.platform,
      arch: process.arch,
    })
  })

  it('resolves DSH_DESKTOP_PLATFORM and DSH_DESKTOP_ARCH overrides', () => {
    expect(resolveTarget({ DSH_DESKTOP_PLATFORM: 'darwin', DSH_DESKTOP_ARCH: 'arm64' })).toEqual({
      target: 'darwin-arm64',
      platform: 'darwin',
      arch: 'arm64',
    })
    expect(resolveTarget({ DSH_DESKTOP_PLATFORM: 'win32', DSH_DESKTOP_ARCH: 'x64' })).toEqual({
      target: 'win32-x64',
      platform: 'win32',
      arch: 'x64',
    })
  })

  it('rejects a target that does not match its native host', () => {
    expect(() => { requireNativeHost({ target: 'darwin-arm64', platform: 'darwin', arch: 'arm64' }, 'darwin-x64') })
      .toThrow(/packaging target darwin-arm64 is not supported on a darwin-x64 host/)
    expect(() => { requireNativeHost({ target: 'win32-x64', platform: 'win32', arch: 'x64' }, 'darwin-arm64') })
      .toThrow(/packaging target win32-x64 is not supported on a darwin-arm64 host/)
  })

  it('rejects hosts outside the supported native targets', () => {
    expect(() => { requireSupportedHost('linux-x64') }).toThrow(/host linux-x64 is outside the supported packaging targets/)
  })

  it('locates packaged application directories and executables per target', () => {
    expect(packagedApplicationDirectory('/out', 'darwin-arm64')).toBe(join('/out', 'DSH-darwin-arm64'))
    expect(packagedExecutablePath('/out', 'darwin-arm64')).toBe(
      join('/out', 'DSH-darwin-arm64', 'DSH.app', 'Contents', 'MacOS', 'DSH'),
    )
    expect(packagedApplicationDirectory('/out', 'win32-x64')).toBe(join('/out', 'DSH-win32-x64'))
    expect(packagedExecutablePath('/out', 'win32-x64')).toBe(join('/out', 'DSH-win32-x64', 'DSH.exe'))
  })

  it('runs Windows package-manager commands through the inherited pnpm CLI', () => {
    const environment = { npm_execpath: 'C:\\tools\\pnpm.cjs' }

    expect(resolvePackageManagerLaunch('npm', ['run', 'build:lib:host'], environment, 'win32')).toEqual({
      command: process.execPath,
      args: ['C:\\tools\\pnpm.cjs', 'run', 'build:lib:host'],
    })
    expect(resolvePackageManagerLaunch('npm', ['--prefix', 'C:\\repo\\apps\\web', 'run', 'build'], environment, 'win32')).toEqual({
      command: process.execPath,
      args: ['C:\\tools\\pnpm.cjs', '--dir', 'C:\\repo\\apps\\web', 'run', 'build'],
    })
    expect(resolvePackageManagerLaunch('pnpm', ['--filter', 'desktop', 'deploy'], environment, 'win32')).toEqual({
      command: process.execPath,
      args: ['C:\\tools\\pnpm.cjs', '--filter', 'desktop', 'deploy'],
    })
    expect(resolvePackageManagerLaunch('npm', ['run', 'build:lib:host'], {}, 'darwin')).toEqual({
      command: 'npm',
      args: ['run', 'build:lib:host'],
    })
    expect(() => resolvePackageManagerLaunch('npm', ['run', 'build'], {}, 'win32'))
      .toThrow(/Windows staging must run through pnpm/)
  })
})
