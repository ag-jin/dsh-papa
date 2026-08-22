/** Create a compressed macOS disk image from the ad-hoc signed packaged DSH application. */

import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { packagedApplicationDirectory, requireNativeHost, resolveTarget } from './desktop-target.mjs'
import { verifyDarwinDiskImage, verifyPackagedApplication } from './verify-desktop-artifacts.mjs'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const desktopDirectory = resolve(scriptDirectory, '..')
const outputDirectory = resolve(process.env.DSH_DESKTOP_OUTPUT_DIR ?? join(desktopDirectory, 'out'))
const version = JSON.parse(readFileSync(join(desktopDirectory, 'package.json'), 'utf8')).version

function run(command, args, cwd, environment = process.env) {
  const result = spawnSync(command, args, { cwd, env: environment, stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited with ${String(result.status ?? result.signal)}`)
}

/**
 * Copies a signed application bundle into the disk-image source while preserving its relative framework links.
 * @param {string} source - Packaged application bundle.
 * @param {string} destination - Disk-image source bundle.
 * @returns {void}
 */
export function copyApplicationForDiskImage(source, destination) {
  cpSync(source, destination, { dereference: false, recursive: true, verbatimSymlinks: true })
}

function main() {
  const target = resolveTarget()
  requireNativeHost(target)
  if (target.platform !== 'darwin') throw new Error('dsh-desktop: disk image creation supports only darwin targets')
  const imagePath = join(outputDirectory, `DSH-${version}-${target.arch}.dmg`)
  const temporaryRoot = join(tmpdir(), `dsh-desktop-dmg-${process.pid}`)
  const temporaryOutputDirectory = join(temporaryRoot, 'out')
  const temporaryApplicationPath = join(packagedApplicationDirectory(temporaryOutputDirectory, target.target), 'DSH.app')
  const temporaryImagePath = join(temporaryOutputDirectory, `DSH-${version}-${target.arch}.dmg`)
  rmSync(temporaryRoot, { recursive: true, force: true })
  try {
    run(process.execPath, [join(scriptDirectory, 'package-desktop.mjs')], desktopDirectory, {
      ...process.env,
      DSH_DESKTOP_OUTPUT_DIR: temporaryOutputDirectory,
    })
    verifyPackagedApplication(target, temporaryOutputDirectory)
    const temporaryImageSource = join(temporaryRoot, 'DSH.app')
    copyApplicationForDiskImage(temporaryApplicationPath, temporaryImageSource)
    run('hdiutil', ['create', '-format', 'UDZO', '-imagekey', 'zlib-level=9', '-volname', 'DSH', '-srcfolder', temporaryImageSource, temporaryImagePath], desktopDirectory)
    if (!existsSync(temporaryImagePath)) throw new Error(`dsh-desktop: hdiutil did not produce ${temporaryImagePath}`)
    verifyDarwinDiskImage(target, temporaryOutputDirectory)
    rmSync(outputDirectory, { recursive: true, force: true })
    cpSync(temporaryOutputDirectory, outputDirectory, { dereference: false, recursive: true, verbatimSymlinks: true })
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
  verifyPackagedApplication(target)
  verifyDarwinDiskImage(target)
  console.log(`dsh-desktop: disk image for the ad-hoc signed, non-notarized application at ${imagePath}`)
}

if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main()