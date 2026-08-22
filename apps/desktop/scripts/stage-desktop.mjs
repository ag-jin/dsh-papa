/** Assemble the standalone runtime and renderer consumed by the desktop packagers. */

import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { requireNativeHost, requireSupportedHost, resolveTarget } from './desktop-target.mjs'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const desktopDirectory = resolve(scriptDirectory, '..')
const repositoryRoot = resolve(desktopDirectory, '../..')
const stageDirectory = resolve(process.env.DSH_DESKTOP_STAGE_DIR ?? join(tmpdir(), `dsh-desktop-stage-${process.pid}`))

/**
 * Resolves a package-manager launch without executing a Windows command wrapper through a shell.
 * @param {string} command - Requested package-manager command.
 * @param {string[]} args - Requested command arguments.
 * @param {NodeJS.ProcessEnv} [environment] - Process environment to inspect.
 * @param {string} [platform] - Host platform to resolve for.
 * @returns {{ command: string, args: string[] }} Node executable and arguments to launch.
 */
export function resolvePackageManagerLaunch(command, args, environment = process.env, platform = process.platform) {
  if (platform !== 'win32' || (command !== 'npm' && command !== 'pnpm')) return { command, args }
  const pnpmCli = environment.npm_execpath
  if (pnpmCli === undefined || pnpmCli === '') {
    throw new Error('dsh-desktop: Windows staging must run through pnpm so its CLI entry is available')
  }
  if (command === 'npm') {
    if (args[0] === 'run') return { command: process.execPath, args: [pnpmCli, 'run', ...args.slice(1)] }
    if (args[0] === '--prefix' && args[2] === 'run') {
      return { command: process.execPath, args: [pnpmCli, '--dir', args[1], 'run', ...args.slice(3)] }
    }
    throw new Error(`dsh-desktop: unsupported npm invocation ${args.join(' ')}`)
  }
  return { command: process.execPath, args: [pnpmCli, ...args] }
}

function run(command, args, cwd = repositoryRoot, environment = process.env) {
  const launcher = resolvePackageManagerLaunch(command, args, environment)
  const result = spawnSync(launcher.command, launcher.args, { cwd, env: environment, stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`${launcher.command} ${launcher.args.join(' ')} exited with ${String(result.status ?? result.signal)}`)
}

function findSymlink(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isSymbolicLink()) return path
    if (entry.isDirectory()) {
      const nested = findSymlink(path)
      if (nested !== undefined) return nested
    }
  }
  return undefined
}

function readManifest(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function dependencyNames(manifest) {
  const peerMetadata = manifest.peerDependenciesMeta ?? {}
  const requiredPeers = Object.keys(manifest.peerDependencies ?? {})
    .filter(name => peerMetadata[name]?.optional !== true)
  return [...new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
    ...requiredPeers,
  ])].sort()
}

function resolveInstalledManifest(packageName, parentManifest) {
  let directory = dirname(parentManifest)
  while (true) {
    const candidate = join(directory, 'node_modules', packageName, 'package.json')
    if (existsSync(candidate)) return realpathSync(candidate)
    const parent = dirname(directory)
    if (parent === directory) return undefined
    directory = parent
  }
}

function samePackage(leftManifest, rightManifest) {
  const left = readManifest(leftManifest)
  const right = readManifest(rightManifest)
  return left.name === right.name && left.version === right.version
}

function copyWithoutNestedNodeModules(source, destination) {
  const nestedNodeModules = join(source, 'node_modules')
  cpSync(source, destination, {
    dereference: true,
    recursive: true,
    filter: path => path !== nestedNodeModules && !path.startsWith(nestedNodeModules + sep),
  })
}

function removeStagedPath(path) {
  if (!existsSync(path)) return
  if (lstatSync(path).isSymbolicLink()) unlinkSync(path)
  else rmSync(path, { recursive: true, force: true })
}

/**
 * Fill dependencies omitted by legacy deploy from the source production installation graph.
 * @param {string} sourceManifest - Manifest at the source production root.
 * @param {string} targetDirectory - Staged deployment directory to complete.
 * @returns {void}
 */
export function materializeProductionClosure(sourceManifest, targetDirectory) {
  const targetManifest = join(targetDirectory, 'package.json')
  const targetNodeModules = join(targetDirectory, 'node_modules')
  const pending = [[realpathSync(sourceManifest), targetManifest]]
  const visited = new Set()

  while (pending.length > 0) {
    const [sourceParentManifest, targetParentManifest] = pending.pop()
    const sourceParent = readManifest(sourceParentManifest)
    for (const packageName of dependencyNames(sourceParent)) {
      const sourceDependencyManifest = resolveInstalledManifest(packageName, sourceParentManifest)
      if (sourceDependencyManifest === undefined) {
        if (sourceParent.optionalDependencies?.[packageName] !== undefined) continue
        throw new Error(`dsh-desktop: cannot resolve production dependency ${packageName} from ${sourceParentManifest}`)
      }

      let targetDependencyManifest = resolveInstalledManifest(packageName, targetParentManifest)
      if (targetDependencyManifest !== undefined && !samePackage(sourceDependencyManifest, targetDependencyManifest)) {
        targetDependencyManifest = undefined
      }
      if (targetDependencyManifest === undefined) {
        const rootDestination = join(targetNodeModules, packageName)
        const rootManifest = join(rootDestination, 'package.json')
        const destination = existsSync(rootManifest) && !samePackage(sourceDependencyManifest, rootManifest)
          ? join(dirname(targetParentManifest), 'node_modules', packageName)
          : rootDestination
        removeStagedPath(destination)
        mkdirSync(dirname(destination), { recursive: true })
        copyWithoutNestedNodeModules(dirname(sourceDependencyManifest), destination)
        targetDependencyManifest = join(destination, 'package.json')
      }

      const key = `${sourceDependencyManifest}\0${targetDependencyManifest}`
      if (visited.has(key)) continue
      visited.add(key)
      pending.push([sourceDependencyManifest, targetDependencyManifest])
    }
  }
}

function restoreLegacyHoists() {
  const manifest = JSON.parse(readFileSync(join(stageDirectory, 'package.json'), 'utf8'))
  const sourceNodeModules = join(desktopDirectory, 'node_modules')
  const restored = []
  for (const dependency of Object.keys(manifest.dependencies ?? {}).sort()) {
    const destination = join(stageDirectory, 'node_modules', dependency)
    if (existsSync(destination)) continue
    const source = join(sourceNodeModules, dependency)
    if (!existsSync(source)) {
      throw new Error(`dsh-desktop: deployed dependency ${dependency} is absent from ${destination} and ${source}`)
    }
    mkdirSync(dirname(destination), { recursive: true })
    copyWithoutNestedNodeModules(source, destination)
    restored.push(dependency)
  }
  if (restored.length > 0) console.log(`dsh-desktop: restored legacy deploy hoists: ${restored.join(', ')}`)
}

function materializeStagedLinks() {
  const nodeModules = join(stageDirectory, 'node_modules')
  let remaining = findSymlink(nodeModules)
  while (remaining !== undefined) {
    const segments = remaining.slice(nodeModules.length + 1).split(sep)
    const binIndex = segments.lastIndexOf('.bin')
    if (binIndex >= 0) {
      rmSync(join(nodeModules, ...segments.slice(0, binIndex + 1)), { recursive: true, force: true })
    } else {
      const source = realpathSync(remaining)
      unlinkSync(remaining)
      copyWithoutNestedNodeModules(source, remaining)
    }
    remaining = findSymlink(nodeModules)
  }
}

function removeSourceMaps(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) removeSourceMaps(path)
    else if (entry.isFile() && entry.name.endsWith('.map')) rmSync(path)
  }
}

function findSourceMap(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      const nested = findSourceMap(path)
      if (nested !== undefined) return nested
    } else if (entry.isFile() && entry.name.endsWith('.map')) {
      return path
    }
  }
  return undefined
}

function writeStageManifest() {
  const manifestPath = join(stageDirectory, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const electronManifest = JSON.parse(readFileSync(join(desktopDirectory, 'node_modules', 'electron', 'package.json'), 'utf8'))
  manifest.devDependencies = { electron: electronManifest.version }
  manifest.productName = 'DSH'
  manifest.config = { ...manifest.config, forge: './forge.config.cjs' }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
}

function assertStagedResources() {
  const required = [
    join(stageDirectory, 'lib', 'electron-runner.js'),
    join(stageDirectory, 'lib', 'preload-electron.cjs'),
    join(stageDirectory, 'config', 'cordis.yml'),
    join(stageDirectory, 'config', 'agent-presets', 'standard'),
    join(stageDirectory, 'renderer', 'index.html'),
    join(stageDirectory, 'node_modules'),
    join(stageDirectory, 'node_modules', '@deepseek-ai', 'cosmokit'),
    join(stageDirectory, 'node_modules', '@deepseek-ai', 'schemastery'),
    join(stageDirectory, 'node_modules', '@standard-schema', 'spec'),
  ]
  for (const path of required) {
    if (!existsSync(path)) throw new Error(`dsh-desktop: staging did not produce ${path}`)
  }
  const remaining = findSymlink(join(stageDirectory, 'node_modules'))
  if (remaining !== undefined) throw new Error(`dsh-desktop: staged runtime retains symbolic link ${remaining}`)
  const sourceMap = findSourceMap(stageDirectory)
  if (sourceMap !== undefined) throw new Error(`dsh-desktop: staged runtime retains source map ${sourceMap}`)
}

function main() {
  requireSupportedHost()
  requireNativeHost(resolveTarget())
  run('npm', ['run', 'build:lib:host'])
  run('npm', ['run', 'build:lib:client'])
  run('npm', ['--prefix', join(repositoryRoot, 'apps', 'web'), 'run', 'build'])
  run('npm', ['--prefix', desktopDirectory, 'run', 'build'])

  rmSync(stageDirectory, { recursive: true, force: true })
  mkdirSync(stageDirectory, { recursive: true })
  run('pnpm', [
    '--filter', '@deepseek-ai/dsh-desktop', 'deploy', '--legacy', '--prod',
    '--config.node-linker=hoisted',
    '--config.auto-install-peers=false',
    '--config.link-workspace-packages=true',
    stageDirectory,
  ], repositoryRoot, { ...process.env, CI: 'true' })
  restoreLegacyHoists()
  materializeStagedLinks()
  materializeProductionClosure(join(desktopDirectory, 'package.json'), stageDirectory)
  materializeStagedLinks()
  cpSync(join(desktopDirectory, 'forge.config.cjs'), join(stageDirectory, 'forge.config.cjs'))
  writeFileSync(join(stageDirectory, '.npmrc'), 'node-linker=hoisted\n')
  cpSync(join(repositoryRoot, 'apps', 'web', 'dist'), join(stageDirectory, 'renderer'), { recursive: true })
  removeSourceMaps(stageDirectory)
  writeStageManifest()
  assertStagedResources()
  console.log(`dsh-desktop: staged desktop runtime at ${stageDirectory}`)
}

if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main()
