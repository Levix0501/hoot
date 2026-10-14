// Writes the body of a version's draft release to standard output: the
// version's section of CHANGELOG.md, then how to install Hoot. The release
// workflow passes the version in package.json.
//
//   node scripts/release-notes.ts <version>
import fs from 'node:fs'
import path from 'node:path'

const INSTALLING = `## Installing

- **Mac**: download the DMG for your Mac's chip, \`arm64\` for Apple Silicon or \`x64\` for Intel, open it and drag Hoot to Applications.
- **Windows**: Hoot for Windows is a preview. For now adding projects works, with Git on \`PATH\` (where Git for Windows puts it by default), but starting sessions does not yet. The installer is not signed, so Microsoft Defender SmartScreen may say "Windows protected your PC": click **More info**, then **Run anyway**. It cannot be installed on a PC with Smart App Control turned on.
`

/** The body of `version`'s draft release, from the text of CHANGELOG.md. */
export function releaseNotes(changelog: string, version: string): string {
  const lines = changelog.split(/\r?\n/)
  const start = lines.findIndex((line) => line.trim() === `## ${version}`)
  if (start === -1) throw new Error(`CHANGELOG.md has no section for ${version}.`)
  const next = lines.findIndex((line, index) => index > start && line.startsWith('## '))
  const section = lines
    .slice(start + 1, next === -1 ? undefined : next)
    .join('\n')
    .trim()
  return `${section}\n\n${INSTALLING}`
}

if (import.meta.main) {
  const version = process.argv[2]
  if (!version) {
    console.error('Usage: node scripts/release-notes.ts <version>')
    process.exit(1)
  }
  const changelog = fs.readFileSync(path.join(import.meta.dirname, '..', 'CHANGELOG.md'), 'utf8')
  process.stdout.write(releaseNotes(changelog, version))
}
