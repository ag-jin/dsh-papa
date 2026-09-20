/**
 * The assembled Web client mounts the Remote hosts switcher: its sidebar entry
 * and its panel come from the real roster, and the Remote namespace it waits on
 * is mounted by the API assembly rather than stubbed by this test.
 */

// @vitest-environment jsdom
import { act } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { installAssembledBootEnv, mountAssembledApp } from './assembled-boot.ts'

installAssembledBootEnv()

describe('assembled remote-host switcher', () => {
  it('activates the switcher and its Remote namespace from the shipped roster', async () => {
    const errors: string[] = []
    const originalError = console.error
    console.error = (...args: unknown[]) => { errors.push(args.map(entry => String(entry)).join(' ')) }
    try {
      mountAssembledApp()
      // The boot resolves the plugin graph asynchronously, and the shell renders
      // its sidebar entries only after every entry reaches active.
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)) })
    } finally {
      console.error = originalError
    }

    // A failed apply in the API assembly leaves every consumer pending and
    // reports the count here; the switcher's own row must not be among them.
    const boot = errors.join('\n')
    expect(boot).not.toContain('did not activate')
    expect(boot).not.toContain('dsh-api-remotes: failed')
    expect(boot).not.toMatch(/dsh-client-ui-remote-hosts: pending/u)

    // The sidebar entry the switcher contributes is rendered by the real shell,
    // labelled from the switcher's own dictionary.
    expect(document.body.textContent).not.toContain('Failed to load plugins')
    const entry = document.querySelector('button[aria-label="Remote hosts"]')
    expect(entry).not.toBeNull()
  })
})
