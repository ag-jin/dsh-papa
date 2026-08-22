/** Create a versioned Windows ZIP from the packaged DSH application via the Electron Forge ZIP maker. */

import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { requireNativeHost, resolveTarget } from './desktop-target.mjs'
import { verifyPackagedApplication, verifyWindowsZip } from './verify-desktop-artifacts.mjs'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const desktopDirectory = resolve(scriptDirectory, '..')
const outputDirectory = resolve(process.env.DSH_DESKTOP_OUTPUT_DIR ?? join(desktopDirectory, 'out'))
const forgeCliPath = join(desktopDirectory, 'node_modules', '@electron-forge', 'cli', 'dist', 'electron-forge.js')
const version = JSON.parse(readFileSync(join(desktopDirectory, 'package.json'), 'utf8')).version

function run(command, args, cwd, environment = process.env) {
  const result = spawnSync(command, args, { cwd, env: environment, stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited with ${String(result.status ?? result.signal)}`)
}

function main() {
  const target = resolveTarget()
  requireNativeHost(target)
  if (target.platform !== 'win32') throw new Error('dsh-desktop: Windows ZIP creation supports only win32 targets')
  const temporaryRoot = join(tmpdir(), `dsh-desktop-zip-${process.pid}`)
  const stageDirectory = join(temporaryRoot, 'stage')
  const temporaryOutputDirectory = join(temporaryRoot, 'out')
  rmSync(temporaryRoot, { recursive: true, force: true })
  try {
    run(process.execPath, [join(scriptDirectory, 'stage-desktop.mjs')], desktopDirectory, {
      ...process.env,
      DSH_DESKTOP_STAGE_DIR: stageDirectory,
    })
    run(process.execPath, [forgeCliPath, 'make', '.', '--platform', target.platform, '--arch', target.arch], stageDirectory, {
      ...process.env,
      DSH_DESKTOP_FORGE_OUT: temporaryOutputDirectory,
      DSH_DESKTOP_FORGE_MAKER_ZIP: join(desktopDirectory, 'node_modules', '@electron-forge', 'maker-zip', 'dist', 'MakerZIP.js'),
      PNPM_CONFIG_NODE_LINKER: 'hoisted',
    })
    verifyPackagedApplication(target, temporaryOutputDirectory)
    verifyWindowsZip(target, temporaryOutputDirectory)
    rmSync(outputDirectory, { recursive: true, force: true })
    cpSync(temporaryOutputDirectory, outputDirectory, { dereference: false, recursive: true, verbatimSymlinks: true })
    verifyPackagedApplication(target)
    verifyWindowsZip(target)
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
  const zipPath = join(outputDirectory, 'make', 'zip', target.platform, target.arch, `DSH-${target.target}-${version}.zip`)
  console.log(`dsh-desktop: unsigned application ZIP at ${zipPath}`)
}

main()