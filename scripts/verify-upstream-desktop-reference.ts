/** Verify the pinned Anywhere Labs desktop reference record and its allowed contents. */

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const referenceRoot = join(repositoryRoot, 'upstream', 'deepseek-harness-desktop', 'dsh-plugin-desktop')
const expected = {
  tag: 'v2.0.1',
  commit: '34c8f4b9bf90faaac82deb65661fccbc9d819a0e',
  licenseSha256: 'ae36246eca21ae16838d566147ab356fd79bdf9ae1c2aa53349700e083f2d679',
}

function requireRecord(source: string, line: string): void {
  if (!source.includes(line)) throw new Error(`upstream desktop reference: missing ${line}`)
}

function main(): void {
  const source = readFileSync(join(referenceRoot, 'UPSTREAM.md'), 'utf8')
  requireRecord(source, `- Tag: \`${expected.tag}\``)
  requireRecord(source, `- Commit: \`${expected.commit}\``)
  requireRecord(source, `- License SHA-256: \`${expected.licenseSha256}\``)

  const license = readFileSync(join(referenceRoot, 'LICENSE'))
  const digest = createHash('sha256').update(license).digest('hex')
  if (digest !== expected.licenseSha256) {
    throw new Error(`upstream desktop reference: LICENSE digest ${digest} does not match ${expected.licenseSha256}`)
  }

  const entries = readdirSync(referenceRoot).sort()
  const allowed = ['LICENSE', 'UPSTREAM.md']
  if (entries.length !== allowed.length || entries.some((entry, index) => entry !== allowed[index])) {
    throw new Error(`upstream desktop reference: expected only ${allowed.join(', ')}, got ${entries.join(', ')}`)
  }

  console.log(`upstream desktop reference: verified ${expected.tag} at ${expected.commit}`)
}

main()
