import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createPackagedDesktopLocations } from '../src/packaged-desktop-boot.ts'

describe('packaged desktop locations', () => {
  it('keeps source execution rooted in the desktop and web worktree directories', () => {
    const locations = createPackagedDesktopLocations({ isPackaged: false, resourcesPath: '/ignored' })

    expect(locations.boot.packageRoot).toMatch(/apps\/desktop\/?$/)
    expect(locations.boot.configPath).toMatch(/apps\/desktop\/config\/cordis\.yml$/)
    expect(locations.boot.presetRoot).toMatch(/apps\/desktop\/config\/agent-presets$/)
    expect(locations.rendererRoot).toMatch(/apps\/web\/dist\/?$/)
    expect(locations.preloadPath).toMatch(/apps\/desktop\/(?:lib|src)\/preload-electron\.cjs$/)
  })

  it('uses only packaged Electron resources after application packaging', () => {
    const resourcesPath = '/Applications/DSH.app/Contents/Resources'
    const locations = createPackagedDesktopLocations({ isPackaged: true, resourcesPath })

    expect(locations.boot.packageRoot).toBe(join(resourcesPath, 'app.asar.unpacked'))
    expect(locations.boot.packageAnchor).toBe(join(resourcesPath, 'app.asar.unpacked', 'package.json'))
    expect(locations.boot.configPath).toBe(join(resourcesPath, 'config', 'cordis.yml'))
    expect(locations.boot.presetRoot).toBe(join(resourcesPath, 'config', 'agent-presets'))
    expect(locations.rendererRoot).toBe(join(resourcesPath, 'renderer'))
  })
})
