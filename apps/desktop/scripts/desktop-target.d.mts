/** Supported native DSH desktop packaging targets and their resolved paths. */
export const SUPPORTED_TARGETS: readonly string[]
export function parseTarget(raw: string): { target: string; platform: string; arch: string }
export function resolveTarget(environment?: NodeJS.ProcessEnv): { target: string; platform: string; arch: string }
export function requireNativeHost(resolved: { target: string; platform: string; arch: string }, host?: string): void
export function requireSupportedHost(host?: string): void
export function packagedApplicationDirectory(outputDirectory: string, target: string): string
export function packagedExecutablePath(outputDirectory: string, target: string): string