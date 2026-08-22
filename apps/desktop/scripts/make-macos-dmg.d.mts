/** Copies a signed application bundle into a disk-image source while preserving framework symlinks. */
export function copyApplicationForDiskImage(source: string, destination: string): void

interface DiskImageCommandResult {
  error?: Error
  status: number | null
  signal: NodeJS.Signals | null
  stdout?: string | null
  stderr?: string | null
}

/** Creates a disk image and retries the transient macOS resource-busy failure. */
export function createDarwinDiskImage(
  args: string[],
  cwd: string,
  spawn?: (command: string, args: string[], options: object) => DiskImageCommandResult,
  remove?: (path: string) => void,
  wait?: (milliseconds: number) => Promise<void>,
): Promise<void>
