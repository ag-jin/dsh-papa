/** The askpass handoff keeps the secret out of argv and off the environment, then removes it. */
import { mkdtemp, rm, stat, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { materializeAskpass } from '../src/askpass.ts'

const directories: string[] = []

async function workspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-askpass-spec-'))
  directories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('materializeAskpass', () => {
  it('points ssh at a helper and never puts the password in the child environment', async () => {
    const directory = await workspace()
    const handoff = await materializeAskpass(directory, 'correct horse battery staple')
    const env = handoff.env()

    expect(env.SSH_ASKPASS_REQUIRE).toBe('force')
    expect(env.SSH_ASKPASS).toBeDefined()
    expect(Object.values(env).join(' ')).not.toContain('correct horse battery staple')
    await handoff.dispose()
  })

  it('writes the secret to an owner-only file and the helper echoes it', async () => {
    const directory = await workspace()
    const handoff = await materializeAskpass(directory, 'hunter2')
    const secretPath = join(directory, 'secret')

    expect((await stat(secretPath)).mode & 0o777).toBe(0o600)
    expect(await readFile(secretPath, 'utf8')).toBe('hunter2')

    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const environment = handoff.env()
    const helperPath = environment.SSH_ASKPASS
    if (helperPath === undefined) throw new Error('askpass spec: the handoff must name a helper')
    const printed = await promisify(execFile)(helperPath, [], { env: environment })
    expect(printed.stdout.trim()).toBe('hunter2')
    await handoff.dispose()
  })

  it('removes both files on dispose', async () => {
    const directory = await workspace()
    const handoff = await materializeAskpass(directory, 'secret')
    const helper = handoff.env().SSH_ASKPASS
    if (helper === undefined) throw new Error('askpass spec: the handoff must name a helper')
    await handoff.dispose()

    await expect(stat(helper)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(join(directory, 'secret'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
