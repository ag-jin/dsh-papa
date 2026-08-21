/** Package the staged DSH desktop runtime as an ad-hoc signed macOS arm64 application. */

import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const desktopDirectory = resolve(scriptDirectory, '..')
const outputDirectory = resolve(process.env.DSH_DESKTOP_OUTPUT_DIR ?? join(desktopDirectory, 'out'))
const applicationPath = join(outputDirectory, 'DSH-darwin-arm64', 'DSH.app')
const forgeCliPath = join(desktopDirectory, 'node_modules', '@electron-forge', 'cli', 'dist', 'electron-forge.js')

function run(command, args, cwd, environment = process.env) {
  const result = spawnSync(command, args, { cwd, env: environment, stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited with ${String(result.status ?? result.signal)}`)
}

function requireDarwinArm64() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    throw new Error('dsh-desktop: macOS packaging requires a Darwin arm64 host')
  }
}

function assertPackagedApplication(path) {
  const required = [
    join(path, 'Contents', 'Info.plist'),
    join(path, 'Contents', 'Frameworks', 'Electron Framework.framework', 'Electron Framework'),
    join(path, 'Contents', 'Resources', 'app.asar'),
    join(path, 'Contents', 'Resources', 'app.asar.unpacked', 'node_modules'),
  ]
  for (const entry of required) {
    if (!existsSync(entry)) throw new Error(`dsh-desktop: Forge did not produce ${entry}`)
  }
  run('codesign', ['--verify', '--deep', '--strict', path], desktopDirectory)
}

function main() {
  requireDarwinArm64()
  const temporaryRoot = join(tmpdir(), `dsh-desktop-package-${process.pid}`)
  const stageDirectory = join(temporaryRoot, 'stage')
  const temporaryOutputDirectory = join(temporaryRoot, 'out')
  const temporaryApplicationPath = join(temporaryOutputDirectory, 'DSH-darwin-arm64', 'DSH.app')
  rmSync(temporaryRoot, { recursive: true, force: true })
  try {
    run(process.execPath, [join(scriptDirectory, 'stage-mac.mjs')], desktopDirectory, {
      ...process.env,
      DSH_DESKTOP_STAGE_DIR: stageDirectory,
    })
    run(process.execPath, [forgeCliPath, 'package', '.', '--platform', 'darwin', '--arch', 'arm64'], stageDirectory, {
      ...process.env,
      DSH_DESKTOP_FORGE_OUT: temporaryOutputDirectory,
      PNPM_CONFIG_NODE_LINKER: 'hoisted',
    })
    assertPackagedApplication(temporaryApplicationPath)
    rmSync(outputDirectory, { recursive: true, force: true })
    cpSync(temporaryOutputDirectory, outputDirectory, { dereference: false, recursive: true, verbatimSymlinks: true })
    assertPackagedApplication(applicationPath)
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
  console.log(`dsh-desktop: ad-hoc signed, non-notarized application at ${applicationPath}`)
}

main()
