/** Supported native DSH desktop packaging targets, resolved from explicit or host values. */

import { join } from 'node:path'

/** Packaging targets the desktop tooling can produce, each built only on its native host. */
export const SUPPORTED_TARGETS = Object.freeze(['darwin-arm64', 'darwin-x64', 'win32-x64'])

/**
 * Parses one `<platform>-<arch>` packaging target into its halves.
 * @param {string} raw - Target name such as `darwin-arm64`.
 * @returns {{ target: string, platform: string, arch: string }} Parsed target halves.
 */
export function parseTarget(raw) {
  const separator = raw.indexOf('-')
  if (separator <= 0) {
    throw new Error(`dsh-desktop: invalid packaging target ${JSON.stringify(raw)}; supported targets are ${SUPPORTED_TARGETS.join(', ')}`)
  }
  const platform = raw.slice(0, separator)
  const arch = raw.slice(separator + 1)
  if (!SUPPORTED_TARGETS.includes(raw)) {
    throw new Error(`dsh-desktop: unsupported packaging target ${JSON.stringify(raw)}; supported targets are ${SUPPORTED_TARGETS.join(', ')}`)
  }
  return { target: raw, platform, arch }
}

/**
 * Resolves the packaging target from DSH_DESKTOP_PLATFORM and DSH_DESKTOP_ARCH, defaulting each half to the host.
 * @param {NodeJS.ProcessEnv} [environment] - Process environment to read.
 * @returns {{ target: string, platform: string, arch: string }} Resolved target halves.
 */
export function resolveTarget(environment = process.env) {
  const platform = environment.DSH_DESKTOP_PLATFORM ?? process.platform
  const arch = environment.DSH_DESKTOP_ARCH ?? process.arch
  return parseTarget(`${platform}-${arch}`)
}

/**
 * Rejects a packaging target that does not match its native host.
 * @param {{ target: string, platform: string, arch: string }} resolved - Parsed packaging target.
 * @param {string} [host] - Host `<platform>-<arch>` pair to require.
 * @returns {void}
 */
export function requireNativeHost(resolved, host = `${process.platform}-${process.arch}`) {
  if (resolved.target !== host) {
    throw new Error(`dsh-desktop: packaging target ${resolved.target} is not supported on a ${host} host`)
  }
}

/**
 * Rejects staging or packaging on a host outside the supported native targets.
 * @param {string} [host] - Host `<platform>-<arch>` pair to check.
 * @returns {void}
 */
export function requireSupportedHost(host = `${process.platform}-${process.arch}`) {
  if (!SUPPORTED_TARGETS.includes(host)) {
    throw new Error(`dsh-desktop: host ${host} is outside the supported packaging targets (${SUPPORTED_TARGETS.join(', ')})`)
  }
}

/**
 * Resolves the packaged application directory for one target under an output root.
 * @param {string} outputDirectory - Packaging output root.
 * @param {string} target - Target name such as `darwin-arm64`.
 * @returns {string} Absolute packaged application directory path.
 */
export function packagedApplicationDirectory(outputDirectory, target) {
  return join(outputDirectory, `DSH-${target}`)
}

/**
 * Resolves the packaged application executable for one target under an output root.
 * @param {string} outputDirectory - Packaging output root.
 * @param {string} target - Target name such as `darwin-arm64`.
 * @returns {string} Absolute packaged executable path.
 */
export function packagedExecutablePath(outputDirectory, target) {
  const applicationDirectory = packagedApplicationDirectory(outputDirectory, target)
  return target.startsWith('darwin-')
    ? join(applicationDirectory, 'DSH.app', 'Contents', 'MacOS', 'DSH')
    : join(applicationDirectory, 'DSH.exe')
}