/** Create a compressed macOS disk image from the ad-hoc signed packaged DSH application. */

import { spawnSync } from 'node:child_process'
import { copyFileSync, cpSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const desktopDirectory = resolve(scriptDirectory, '..')
const outputDirectory = resolve(process.env.DSH_DESKTOP_OUTPUT_DIR ?? join(desktopDirectory, 'out'))
const applicationPath = join(outputDirectory, 'DSH-darwin-arm64', 'DSH.app')
const version = JSON.parse(readFileSync(join(desktopDirectory, 'package.json'), 'utf8')).version
const imagePath = join(outputDirectory, `DSH-${version}-arm64.dmg`)

function run(command, args, cwd, environment = process.env) {
  const result = spawnSync(command, args, { cwd, env: environment, stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited with ${String(result.status ?? result.signal)}`)
}

function requireDarwinArm64() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    throw new Error('dsh-desktop: DMG creation requires a Darwin arm64 host')
  }
}

function main() {
  requireDarwinArm64()
  const temporaryRoot = join(tmpdir(), `dsh-desktop-dmg-${process.pid}`)
  const temporaryOutputDirectory = join(temporaryRoot, 'out')
  const temporaryApplicationPath = join(temporaryOutputDirectory, 'DSH-darwin-arm64', 'DSH.app')
  const temporaryImagePath = join(temporaryOutputDirectory, `DSH-${version}-arm64.dmg`)
  rmSync(temporaryRoot, { recursive: true, force: true })
  try {
    run(process.execPath, [join(scriptDirectory, 'package-mac.mjs')], desktopDirectory, {
      ...process.env,
      DSH_DESKTOP_OUTPUT_DIR: temporaryOutputDirectory,
    })
    if (!existsSync(temporaryApplicationPath)) throw new Error(`dsh-desktop: application is missing at ${temporaryApplicationPath}`)
    const temporaryImageSource = join(temporaryRoot, 'DSH.app')
    cpSync(temporaryApplicationPath, temporaryImageSource, { dereference: false, recursive: true })
    run('hdiutil', ['create', '-format', 'UDZO', '-imagekey', 'zlib-level=9', '-volname', 'DSH', '-srcfolder', temporaryImageSource, temporaryImagePath], desktopDirectory)
    if (!existsSync(temporaryImagePath)) throw new Error(`dsh-desktop: hdiutil did not produce ${temporaryImagePath}`)
    run('hdiutil', ['verify', temporaryImagePath], desktopDirectory)
    rmSync(outputDirectory, { recursive: true, force: true })
    cpSync(temporaryOutputDirectory, outputDirectory, { dereference: false, recursive: true, verbatimSymlinks: true })
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
  if (!existsSync(applicationPath) || !existsSync(imagePath)) {
    throw new Error(`dsh-desktop: disk image output is incomplete at ${outputDirectory}`)
  }
  run('codesign', ['--verify', '--deep', '--strict', applicationPath], desktopDirectory)
  run('hdiutil', ['verify', imagePath], desktopDirectory)
  console.log(`dsh-desktop: disk image for the ad-hoc signed, non-notarized application at ${imagePath}`)
}

main()
