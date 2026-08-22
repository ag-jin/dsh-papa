import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const patchPath = fileURLToPath(new URL('../cordis.patch.yml', import.meta.url))
const packagePath = fileURLToPath(new URL('../package.json', import.meta.url))

describe('desktop-app bundle', () => {
  it('composes the desktop runtime and client graph without web listener rows', () => {
    const patch = readFileSync(patchPath, 'utf8')
    const manifest = JSON.parse(readFileSync(packagePath, 'utf8')) as {
      dependencies?: Record<string, string>
    }

    expect(manifest.dependencies).toMatchObject({
      '@deepseek-ai/dsh-base': 'workspace:^',
      '@deepseek-ai/dsh-desktop-runtime': 'workspace:^',
      '@deepseek-ai/dsh-host-apiproxy': 'workspace:^',
      '@deepseek-ai/dsh-client-modules': 'workspace:^',
      '@deepseek-ai/dsh-client-connection': 'workspace:^',
      '@deepseek-ai/dsh-host-directory-picker-native': 'workspace:^',
      '@deepseek-ai/dsh-client-ui-directory-picker-native': 'workspace:^',
    })
    for (const unused of [
      '@deepseek-ai/dsh-host-directory-picker-auto',
      '@deepseek-ai/dsh-host-directory-picker-browse',
      '@deepseek-ai/dsh-client-ui-directory-picker-browse',
    ]) expect(manifest.dependencies).not.toHaveProperty(unused)
    for (const id of ['api-gateway', 'modules', 'connection', 'desktop-runtime', 'desktop-app-invariant', 'directory-picker', 'ui-directory-picker']) {
      expect(patch).toContain('id: ' + id)
    }
    expect(patch).toContain("name: '@deepseek-ai/dsh-host-directory-picker-native'")
    expect(patch).not.toContain('@deepseek-ai/dsh-host-directory-picker-auto')
    expect(patch).toContain("id: agent-presets\n      name: '@deepseek-ai/dsh-agent-presets'\n      config:\n        default: standard")
    for (const id of [
      'tool-bash', 'tool-pwsh', 'tool-jobs', 'tool-fs', 'tool-fs-search', 'tool-str-replace-editor',
      'skill-filesystem', 'tool-skill', 'tool-goal', 'plan-mode', 'compaction-basic', 'command-compact',
      'tool-result-pruner', 'tool-subagent-control', 'tool-subagent-list-agents', 'tool-subagent',
      'tool-subagent-fork', 'workflow-worker-thread', 'tool-workflow', 'tool-ralph', 'agent-instructions',
      'tool-todo', 'tool-web',
    ]) expect(patch).toContain(`- id: ${id}\n  disabled: true`)
    for (const webOnly of ['webserver', 'web-startup', 'web-runtime', 'frontend-static', 'client-hmr']) {
      expect(patch).not.toContain(webOnly)
    }
  })
})
