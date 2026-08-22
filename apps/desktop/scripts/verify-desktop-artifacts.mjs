/** Verify completed DSH desktop packaging artifacts for the supported native host target. */

import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  packagedApplicationDirectory,
  requireNativeHost,
  resolveTarget,
} from './desktop-target.mjs'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const desktopDirectory = resolve(scriptDirectory, '..')
const outputDirectory = resolve(process.env.DSH_DESKTOP_OUTPUT_DIR ?? join(desktopDirectory, 'out'))
const version = JSON.parse(readFileSync(join(desktopDirectory, 'package.json'), 'utf8')).version

/** Required paths inside a packaged macOS application bundle. */
const macOSApplicationEntries = [
  join('Contents', 'Info.plist'),
  join('Contents', 'Frameworks', 'Electron Framework.framework', 'Electron Framework'),
  join('Contents', 'Resources', 'app.asar'),
  join('Contents', 'Resources', 'app.asar.unpacked', 'node_modules'),
  join('Contents', 'Resources', 'config', 'cordis.yml'),
  join('Contents', 'Resources', 'renderer', 'index.html'),
  join('Contents', 'Resources', 'app.asar.unpacked', 'node_modules', '@deepseek-ai', 'cosmokit'),
  join('Contents', 'Resources', 'app.asar.unpacked', 'node_modules', '@standard-schema', 'spec'),
]

/** Required paths inside a packaged Windows application directory. */
const windowsApplicationEntries = [
  'DSH.exe',
  join('resources', 'app.asar'),
  join('resources', 'app.asar.unpacked', 'node_modules'),
  join('resources', 'config', 'cordis.yml'),
  join('resources', 'renderer', 'index.html'),
  join('resources', 'app.asar.unpacked', 'node_modules', '@deepseek-ai', 'cosmokit'),
  join('resources', 'app.asar.unpacked', 'node_modules', '@standard-schema', 'spec'),
]

function run(command, args, cwd, environment = process.env) {
  const result = spawnSync(command, args, { cwd, env: environment, stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited with ${String(result.status ?? result.signal)}`)
}

function capture(command, args, cwd = desktopDirectory) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited with ${String(result.status ?? result.signal)}`)
  return result.stdout
}

function assertEntitlement(applicationPath, entitlement) {
  const entitlements = capture('codesign', ['--display', '--entitlements', ':-', applicationPath])
  const enabled = new RegExp(`<key>${entitlement}</key>\\s*<true\\s*/>`).test(entitlements)
  if (!enabled) throw new Error(`dsh-desktop: ${applicationPath} is missing ${entitlement}`)
}

/**
 * Verifies an application directory materialized from a desktop delivery artifact.
 * @param {{ target: string, platform: string, arch: string }} target - Resolved packaging target.
 * @param {string} applicationDirectory - Application bundle or Windows application directory.
 * @returns {void}
 */
export function verifyMaterializedApplication(target, applicationDirectory) {
  const entries = target.platform === 'darwin' ? macOSApplicationEntries : windowsApplicationEntries
  for (const entry of entries) {
    if (!existsSync(join(applicationDirectory, entry))) {
      throw new Error(`dsh-desktop: packaged application is missing ${join(applicationDirectory, entry)}`)
    }
  }
  if (target.platform !== 'darwin') return

  run('codesign', ['--verify', '--deep', '--strict', applicationDirectory], desktopDirectory)
  for (const helper of [
    applicationDirectory,
    join(applicationDirectory, 'Contents', 'Frameworks', 'DSH Helper.app'),
    join(applicationDirectory, 'Contents', 'Frameworks', 'DSH Helper (GPU).app'),
    join(applicationDirectory, 'Contents', 'Frameworks', 'DSH Helper (Renderer).app'),
  ]) {
    assertEntitlement(helper, 'com.apple.security.cs.allow-jit')
    assertEntitlement(helper, 'com.apple.security.cs.disable-library-validation')
  }
  const pluginHelper = join(applicationDirectory, 'Contents', 'Frameworks', 'DSH Helper (Plugin).app')
  assertEntitlement(pluginHelper, 'com.apple.security.cs.disable-library-validation')
  assertEntitlement(pluginHelper, 'com.apple.security.cs.allow-unsigned-executable-memory')
}

function windowsZipPath(target, directory) {
  return join(directory, 'make', 'zip', target.platform, target.arch, `DSH-${target.target}-${version}.zip`)
}

function extractWindowsZip(zipPath, extractionRoot) {
  run('powershell.exe', [
    '-nologo',
    '-noprofile',
    '-command', '& { param([String]$archive, [String]$destination); Add-Type -A "System.IO.Compression.FileSystem"; [IO.Compression.ZipFile]::ExtractToDirectory($archive, $destination); exit !$? }',
    '-archive', zipPath,
    '-destination', extractionRoot,
  ], desktopDirectory)
}

function materializeDarwinDiskImage(target, directory, destination) {
  const imagePath = join(directory, `DSH-${version}-${target.arch}.dmg`)
  if (!existsSync(imagePath)) throw new Error(`dsh-desktop: disk image is missing at ${imagePath}`)
  const mountPoint = mkdtempSync(join(tmpdir(), 'dsh-desktop-dmg-mount-'))
  let mounted = false
  try {
    run('hdiutil', ['attach', '-quiet', '-nobrowse', '-readonly', '-mountpoint', mountPoint, imagePath], desktopDirectory)
    mounted = true
    run('ditto', [join(mountPoint, 'DSH.app'), destination], desktopDirectory)
  } finally {
    if (mounted) run('hdiutil', ['detach', '-quiet', mountPoint], desktopDirectory)
    rmSync(mountPoint, { recursive: true, force: true })
  }
}

function materializeWindowsZip(target, directory, destination) {
  const zipPath = windowsZipPath(target, directory)
  if (!existsSync(zipPath)) throw new Error(`dsh-desktop: ZIP is missing at ${zipPath}`)
  extractWindowsZip(zipPath, destination)
  return destination
}

/**
 * Materializes an end-user delivery artifact into a writable local directory.
 * @param {{ target: string, platform: string, arch: string }} target - Resolved packaging target.
 * @param {string} directory - Packaging output root containing the delivery artifact.
 * @param {string} destinationRoot - Empty writable directory for the materialized application.
 * @returns {string} Absolute application bundle or Windows application directory.
 */
export function materializeDeliveryArtifact(target, directory, destinationRoot) {
  if (existsSync(destinationRoot)) {
    if (readdirSync(destinationRoot).length > 0) {
      throw new Error(`dsh-desktop: delivery destination must be empty: ${destinationRoot}`)
    }
  } else {
    mkdirSync(destinationRoot, { recursive: true })
  }
  if (target.platform === 'darwin') {
    const applicationDirectory = join(destinationRoot, 'DSH.app')
    materializeDarwinDiskImage(target, directory, applicationDirectory)
    return applicationDirectory
  }
  if (target.platform === 'win32') return materializeWindowsZip(target, directory, destinationRoot)
  throw new Error(`dsh-desktop: cannot materialize delivery artifact for ${target.target}`)
}

/**
 * Verifies the packaged application layout and signature for one target.
 * @param {{ target: string, platform: string, arch: string }} target - Resolved packaging target.
 * @param {string} [directory] - Packaging output root.
 * @returns {void}
 */
export function verifyPackagedApplication(target, directory = outputDirectory) {
  const applicationDirectory = target.platform === 'darwin'
    ? join(packagedApplicationDirectory(directory, target.target), 'DSH.app')
    : packagedApplicationDirectory(directory, target.target)
  verifyMaterializedApplication(target, applicationDirectory)
}

/**
 * Verifies the per-arch macOS disk image and the mounted application layout.
 * @param {{ target: string, platform: string, arch: string }} target - Resolved packaging target.
 * @param {string} [directory] - Packaging output root.
 * @returns {void}
 */
export function verifyDarwinDiskImage(target, directory = outputDirectory) {
  const imagePath = join(directory, `DSH-${version}-${target.arch}.dmg`)
  if (!existsSync(imagePath)) throw new Error(`dsh-desktop: disk image is missing at ${imagePath}`)
  run('hdiutil', ['verify', imagePath], desktopDirectory)

  const temporaryRoot = mkdtempSync(join(tmpdir(), 'dsh-desktop-dmg-verify-'))
  try {
    const applicationDirectory = materializeDeliveryArtifact(target, directory, temporaryRoot)
    verifyMaterializedApplication(target, applicationDirectory)
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
}

/**
 * Verifies the versioned Windows ZIP after extracting its complete application layout.
 * @param {{ target: string, platform: string, arch: string }} target - Resolved packaging target.
 * @param {string} [directory] - Packaging output root.
 * @returns {void}
 */
export function verifyWindowsZip(target, directory = outputDirectory) {
  const extractionRoot = mkdtempSync(join(tmpdir(), 'dsh-desktop-zip-verify-'))
  try {
    const applicationDirectory = materializeDeliveryArtifact(target, directory, extractionRoot)
    verifyMaterializedApplication(target, applicationDirectory)
  } finally {
    rmSync(extractionRoot, { recursive: true, force: true })
  }
}

function main() {
  const target = resolveTarget()
  requireNativeHost(target)
  verifyPackagedApplication(target)
  if (target.platform === 'darwin') verifyDarwinDiskImage(target)
  else verifyWindowsZip(target)
  console.log(`dsh-desktop: verified ${target.target} packaging artifacts at ${outputDirectory}`)
}

if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main()
