/** Resolved desktop packaging target. */
export interface DesktopTarget {
  target: string
  platform: string
  arch: string
}

/** Verifies the complete application layout after delivery artifact materialization. */
export function verifyMaterializedApplication(target: DesktopTarget, applicationDirectory: string): void

/** Materializes a delivery DMG or ZIP into an empty writable directory. */
export function materializeDeliveryArtifact(target: DesktopTarget, directory: string, destinationRoot: string): string

/** Verifies the loose packaged application layout for one target. */
export function verifyPackagedApplication(target: DesktopTarget, directory?: string): void

/** Verifies a macOS disk image and its materialized application bundle. */
export function verifyDarwinDiskImage(target: DesktopTarget, directory?: string): void

/** Verifies a Windows ZIP and its extracted application directory. */
export function verifyWindowsZip(target: DesktopTarget, directory?: string): void
