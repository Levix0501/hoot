# Contributing to Hoot

Thank you for helping out! Bug reports, ideas and pull requests are all welcome.

- **Bugs and ideas**: [open an issue](https://github.com/Levix0501/hoot/issues). For a bug, say what
  you did, what happened and what you expected, along with your Hoot version (**Settings › About**)
  and operating system.
- **Pull requests**: for a larger change, opening an issue first to agree on the approach saves
  everyone time.
- **Security vulnerabilities**: report them privately, as [SECURITY.md](SECURITY.md) describes, not
  in public issues.

## Development setup

Hoot is developed on macOS; CI also checks it on Windows. You need:

- Node.js 24
- pnpm, the version pinned in `package.json`, which Corepack (part of Node.js) picks up
- Git (on Windows, Git for Windows)

```sh
pnpm install
pnpm build
pnpm start
```

`pnpm start` opens the built app the way Finder does, so the app and its sessions get your graphical
login environment rather than the terminal's. Add `--background` (`pnpm start --background`) for
unattended checks: the window then stays off screen until you click Hoot's Dock icon.

`pnpm dev` runs Vite with hot reload and starts Electron from the current terminal. The app then
inherits the terminal's environment, so check anything that depends on the environment with
`pnpm start`.

A Hoot run from the repository keeps its projects, issues and settings apart from an installed
Hoot, in `Hoot-dev` instead of `Hoot`, so both can run at the same time.

Electron's binary is downloaded the first time it is needed. If downloads from GitHub are slow
where you are, point Electron at a mirror first:

```sh
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
```

## Checks

```sh
pnpm typecheck     # TypeScript
pnpm lint          # oxlint
pnpm format:check  # oxfmt; pnpm format fixes the formatting
pnpm test          # Vitest
pnpm check         # all of the above
```

CI runs `pnpm check` on macOS and on Windows, where the tests of what Hoot does only on macOS are
skipped. On Windows the tests need Git for Windows and permission to create symbolic links, which
Developer Mode or an administrator's shell gives.

To check a change in the running app, drive the built app with Playwright's Electron support
(`_electron.launch`), with a temporary `--user-data-dir` so that it keeps its own data, and
`--background`. With `--test-hooks`, the page also exposes the sessions' terminals as
`window.hootTestHooks`. `--windows-layout` leaves room for the Windows window buttons at the right
end of the top row, to check on a Mac what they would cover.

## Project layout

| Path           | What it holds                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------- |
| `src/main`     | The main process: window, menus, database, projects, issues, worktrees, agents and sessions       |
| `src/pty-host` | The utility process that runs the sessions' terminals, the only place node-pty is loaded          |
| `src/preload`  | `window.hoot`, the bridge between the renderer and the main process                               |
| `src/renderer` | The interface: React 19, zustand, Tailwind CSS 4, shadcn/ui on Base UI, and xterm.js              |
| `src/shared`   | Types and messages used by more than one process                                                  |
| `src/cli`      | The `hoot` command, which Hoot's executable runs as Node.js; its launchers are in `resources/bin` |

Vite builds everything with `vite-plugin-electron`, bundling every package except node-pty, the only
runtime dependency.

- **Data**: projects, issues and labels are kept in a SQLite database, `data/hoot.db` in the user
  data folder, through Node's built-in `node:sqlite`; settings are in `settings.json` beside it. The
  database changes only through a new migration added at the end of `src/main/database`, which keeps
  the data already there. A migration that has been released is never changed.
- **Icons** come from [lucide](https://lucide.dev), except the agents' marks in
  `src/renderer/assets/brand-icons`: Claude Code's and Codex's are taken from Anthropic's and
  OpenAI's extensions for VS Code, and OpenCode's from its brand assets. They are their owners'
  trademarks.

## Commits and changesets

- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org):
  `type(scope): subject`, such as `fix(worktrees): keep the branch of a deleted worktree`.
- A change that users of Hoot would notice comes with a changeset, in the same commit as the change.
  Run `pnpm changeset`, or add a file to `.changeset/` yourself: it says whether the change is a
  `patch`, `minor` or `major` one and describes it in one sentence for users. That sentence becomes
  the change's entry in `CHANGELOG.md` and in the release notes.
- Keep [README.md](README.md) short: it says what Hoot is and how to start using it. How each
  feature behaves belongs in the app, not in the README.

## Building and installing on your Mac

```sh
pnpm app:install
```

packages Hoot for your Mac's architecture and installs it as `/Applications/Hoot.app`, replacing
the one installed; `pnpm app:package` only packages it, into `release/`. If your keychain holds a
"Developer ID Application" certificate, the app is signed with it, so that macOS keeps the
permissions you grant Hoot when you install a new build. These builds are not notarized, so they
are meant for the Mac that built them, and they do not update themselves: run `pnpm app:install`
again, then restart Hoot. Restarting ends the running sessions.

## Releasing

This part is for maintainers. Releases are made with [Changesets](https://github.com/changesets/changesets)
and the Release workflow, `.github/workflows/release.yml`. Hoot is in Changesets' prerelease mode,
so versions are alpha prereleases (`0.1.0-alpha.0`, `0.1.0-alpha.1` and on) until
`pnpm changeset pre exit`.

1. Push to `main`. Once `pnpm check` passes, the workflow opens the pull request
   "chore(release): version packages (alpha)", or updates it, with the next version in
   `package.json` and its section in `CHANGELOG.md`.
2. Merge that pull request. The workflow tags the merge `v<version>`, builds the installers, signed
   and notarized for macOS, and drafts a pre-release with them and the version's changelog.
3. Check the draft on the Releases page and publish it. The workflow never publishes a release.
   Once one is published, earlier versions of Hoot offer it as an update.

To try a build without releasing anything, run the workflow from the Actions page (**Release** ›
**Run workflow**) on any branch: it checks and builds the installers, keeps them as the run's
artifacts, and creates no tag, release, pull request or commit.

The workflow opens pull requests with the token GitHub gives each run, which needs **Settings ›
Actions › General › Allow GitHub Actions to create and approve pull requests**. It signs and
notarizes the Mac apps with these repository secrets:

| Secret                              | Value                                                                                         |
| ----------------------------------- | --------------------------------------------------------------------------------------------- |
| `DEVELOPER_ID_CERTIFICATE_BASE64`   | A "Developer ID Application" certificate with its private key, as a base64 `.p12` file        |
| `DEVELOPER_ID_CERTIFICATE_PASSWORD` | The password the `.p12` file was exported with                                                |
| `APP_STORE_CONNECT_API_KEY`         | The contents of an App Store Connect team API key's `.p8` file (the Developer role is enough) |
| `APP_STORE_CONNECT_API_KEY_ID`      | That key's Key ID                                                                             |
| `APP_STORE_CONNECT_API_ISSUER_ID`   | Its Issuer ID                                                                                 |

Export the certificate from Keychain Access (**My Certificates**, select it with its private key,
**File › Export Items…**), generate the key in App Store Connect under **Users and Access ›
Integrations › App Store Connect API** (its `.p8` file can be downloaded only once), and store them
with the GitHub CLI:

```sh
base64 -i DeveloperID.p12 | gh secret set DEVELOPER_ID_CERTIFICATE_BASE64
gh secret set DEVELOPER_ID_CERTIFICATE_PASSWORD
gh secret set APP_STORE_CONNECT_API_KEY < AuthKey_<Key ID>.p8
gh secret set APP_STORE_CONNECT_API_KEY_ID --body "<Key ID>"
gh secret set APP_STORE_CONNECT_API_ISSUER_ID --body "<Issuer ID>"
```

`pnpm app:release` builds what a release ships on your Mac, in `release/`: DMGs and zips for Apple
silicon and Intel, signed and notarized, the Windows installer, and the update files that list
them. It needs Xcode 26 or later, which compiles the Mac icon, a "Developer ID Application"
certificate in your keychain, and notarization credentials stored in your keychain under the
profile `hoot-notary` (or the one `APPLE_KEYCHAIN_PROFILE` names):

```sh
xcrun notarytool store-credentials hoot-notary --key AuthKey_<Key ID>.p8 --key-id "<Key ID>" --issuer "<Issuer ID>"
```
