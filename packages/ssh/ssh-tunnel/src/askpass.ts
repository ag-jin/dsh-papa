/** The SSH_ASKPASS handoff: a helper script and its secret, owned until disposal. */

import { chmod, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** One materialized handoff. Dispose removes the helper and the secret. */
export interface AskpassHandoff {
  /** Environment entries the spawned `ssh` needs, carrying a path rather than the secret. */
  env(): Record<string, string>
  /** Remove the helper and the secret; safe to call twice. */
  dispose(): Promise<void>
}

const SECRET_FILE = 'secret'

/**
 * `ssh` consults this helper for a password. It prints the secret file's bytes,
 * so the secret travels as a file path in the environment rather than as the
 * environment's own content, where a child process could read it back.
 */
const HELPER_PROGRAM = '#!/bin/sh\ncat "${DSH_SSH_ASKPASS_FILE}"\n'

/**
 * Write the helper and the secret under one directory and return their handoff.
 * @param directory - a directory this connection owns; created by the caller.
 * @param password - the SSH password to hand over.
 * @returns the handoff; dispose removes both files.
 */
export async function materializeAskpass(directory: string, password: string): Promise<AskpassHandoff> {
  const secretPath = join(directory, SECRET_FILE)
  const helperPath = join(directory, 'askpass')
  await writeFile(secretPath, password, { mode: 0o600 })
  await writeFile(helperPath, HELPER_PROGRAM, { mode: 0o700 })
  await chmod(helperPath, 0o700)
  const environment = {
    SSH_ASKPASS: helperPath,
    // Without `force`, ssh ignores the helper whenever a terminal is attached.
    SSH_ASKPASS_REQUIRE: 'force',
    DSH_SSH_ASKPASS_FILE: secretPath,
  }
  return {
    env: () => ({ ...environment }),
    async dispose(): Promise<void> {
      await rm(helperPath, { force: true })
      await rm(secretPath, { force: true })
    },
  }
}
