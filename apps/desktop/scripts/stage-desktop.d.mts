/** Completes a staged production dependency tree from its source installation graph. */
export function materializeProductionClosure(sourceManifest: string, targetDirectory: string): void

/** Resolves a package-manager launch without executing a Windows command wrapper through a shell. */
export function resolvePackageManagerLaunch(
  command: string,
  args: string[],
  environment?: NodeJS.ProcessEnv,
  platform?: string,
): { command: string, args: string[] }
