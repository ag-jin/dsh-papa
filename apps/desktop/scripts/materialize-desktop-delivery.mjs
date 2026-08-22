/** Materialize a native DSH delivery artifact for an end-to-end packaged smoke test. */

import { appendFileSync, existsSync, mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { requireNativeHost, resolveTarget } from './desktop-target.mjs'
import { materializeDeliveryArtifact, verifyMaterializedApplication } from './verify-desktop-artifacts.mjs'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const desktopDirectory = resolve(scriptDirectory, '..')
const outputDirectory = resolve(process.env.DSH_DESKTOP_OUTPUT_DIR ?? join(desktopDirectory, 'out'))

function deliveryExecutablePath(target, applicationDirectory) {
  return target.platform === 'darwin'
    ? join(applicationDirectory, 'Contents', 'MacOS', 'DSH')
    : join(applicationDirectory, 'DSH.exe')
}

function setOutput(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT
  if (outputPath !== undefined && outputPath !== '') appendFileSync(outputPath, `${name}=${value}\n`)
}

function main() {
  const target = resolveTarget()
  requireNativeHost(target)
  const destinationRoot = resolve(process.env.DSH_DESKTOP_DELIVERY_DIR ?? mkdtempSync(join(tmpdir(), 'dsh-desktop-delivery-')))
  const applicationDirectory = materializeDeliveryArtifact(target, outputDirectory, destinationRoot)
  verifyMaterializedApplication(target, applicationDirectory)
  const executable = deliveryExecutablePath(target, applicationDirectory)
  if (!existsSync(executable)) throw new Error(`dsh-desktop: delivery artifact is missing executable ${executable}`)
  setOutput('application-path', executable)
  console.log(`dsh-desktop: materialized ${target.target} delivery executable at ${executable}`)
}

if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main()
