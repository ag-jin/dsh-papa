/** Package the staged DSH desktop runtime as a native application for its supported host target. */

import { spawnSync } from 'node:child_process'
import { cpSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { packagedExecutablePath, requireNativeHost, resolveTarget } from './desktop-target.mjs'
import { verifyPackagedApplication } from './verify-desktop-artifacts.mjs'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const desktopDirectory = resolve(scriptDirectory, '..')
const outputDirectory = resolve(process.env.DSH_DESKTOP_OUTPUT_DIR ?? join(desktopDirectory, 'out'))
const forgeCliPath = join(desktopDirectory, 'node_modules', '@electron-forge', 'cli', 'dist', 'electron-forge.js')

function run(command, args, cwd, environment = process.env) {
  const result = spawnSync(command, args, { cwd, env: environment, stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited with ${String(result.status ?? result.signal)}`)
}

function main() {
  const target = resolveTarget()
  requireNativeHost(target)
  const macOS = target.platform === 'darwin'
  const temporaryRoot = join(tmpdir(), `dsh-desktop-package-${process.pid}`)
  const stageDirectory = join(temporaryRoot, 'stage')
  const temporaryOutputDirectory = join(temporaryRoot, 'out')
  const packagedExecutable = packagedExecutablePath(outputDirectory, target.target)
  rmSync(temporaryRoot, { recursive: true, force: true })
  try {
    run(process.execPath, [join(scriptDirectory, 'stage-desktop.mjs')], desktopDirectory, {
      ...process.env,
      DSH_DESKTOP_STAGE_DIR: stageDirectory,
    })
    run(process.execPath, [forgeCliPath, 'package', '.', '--platform', target.platform, '--arch', target.arch], stageDirectory, {
      ...process.env,
      DSH_DESKTOP_FORGE_OUT: temporaryOutputDirectory,
      PNPM_CONFIG_NODE_LINKER: 'hoisted',
    })
    verifyPackagedApplication(target, temporaryOutputDirectory)
    rmSync(outputDirectory, { recursive: true, force: true })
    cpSync(temporaryOutputDirectory, outputDirectory, { dereference: false, recursive: true, verbatimSymlinks: true })
    verifyPackagedApplication(target)
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
  const signature = macOS ? 'ad-hoc signed, non-notarized' : 'unsigned'
  console.log(`dsh-desktop: ${signature} application at ${packagedExecutable}`)
}

main()