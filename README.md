# Hoot

Hoot is a desktop app for developers who use coding CLIs such as Claude Code, Codex and
OpenCode. Add local Git projects, then run coding tools and shells for them in terminals embedded in
the Hoot window, as many at a time as you like.

Hoot supports macOS only for now.

## Features

- **Projects**: add a local Git repository by choosing any folder inside it (including a linked
  worktree, a submodule, or a repository whose Git directory is kept elsewhere). The project is the
  repository's main worktree, the working directory it was created with. Folders outside Git, bare
  repositories, and folders from which Git cannot tell where the main worktree is (such as a linked
  worktree of a repository whose Git directory is kept elsewhere) are refused. The list is kept
  across restarts. Right-click a project, or use its `⋯` menu, to remove it from the list
  (its files are never touched).
- **Sessions**: start Claude Code (`claude`), Codex (`codex`), OpenCode (`opencode`) or your
  default shell in the project root, from the project's `+` button or its context menu, or in one
  of the project's [worktrees](#worktrees) from the worktree's `+` button. Tools run
  directly in your login shell environment, with only the arguments of their
  [permission level](#permission-levels); the shell runs as an interactive login shell. Tools that
  are not installed are shown disabled with an install command, and **Re-detect Tools** checks
  again at any time.
- **Many sessions at once**: any number of sessions can run at the same time, in the same project
  or in different ones. Each project lists its sessions below it in the sidebar, in the order they
  started, with the tool's icon, the session's name and its state: a green dot while it runs, or how
  it ended. Click a session to show it; the keyboard focus goes to its terminal. Sessions that are
  not shown keep running, and their output is all there when you come back to them.
- **Names**: a session is named after the title its program gives the terminal (without the ✳, ◐
  or ◑ that Claude Code puts first), or after its tool until there is one. Double-click a session,
  or choose **Rename** from its context menu, to name it yourself: Enter saves, Esc cancels, and an
  empty name brings back the default one. Names last until Hoot quits.
- **Closing**: close a session with the button that appears when you point at it, the button in
  the session header, **Close** in its context menu, or **File > Close Session** (⌘W). Closing a
  running session asks first, then ends its process. When a session's process exits with code 0
  the session closes by itself; when it fails, is killed by a signal, or the terminal host stops,
  the session stays with its output and says how it ended, until you close it. When the shown
  session closes, the next one in the sidebar is shown, or the previous one after the last.
- **Back and forward**: like a browser among pages, Hoot goes back and forward among the sessions
  it has shown, with the arrow buttons at the top left, ⌘[ and ⌘] (**Window > Back** and
  **Forward**). Showing a session another way drops the sessions you went back from, and a session
  that closes leaves the list. The list lasts until Hoot quits.
- **Shortcuts**: ⌘1 to ⌘9 show the first to ninth session in the sidebar, ⌘⇧] and ⌘⇧[ (**Window >
  Select Next Session** and **Select Previous Session**) the next and previous one, ⌘[ and ⌘] go
  back and forward, ⌘W closes the shown session, and ⌘B hides or shows the sidebar. They work while
  a terminal has the focus and never reach its program, whereas Ctrl+B reaches it as usual. The
  window's close button and ⌘Q quit Hoot.
- **Terminal**: xterm.js with 16/256/24-bit color, mouse reporting, copy and paste with ⌘C and ⌘V,
  10,000 lines of scrollback for every session, IME input, and wide characters (including emoji) at
  current Unicode widths. The shown terminal is drawn with WebGL, so block elements and box drawing
  characters (such as Claude Code's mascot and the frames tools draw) fill their cells without
  gaps; without WebGL it falls back to the DOM renderer. Text is set in Geist Mono at 14 pixels,
  which comes with Hoot, in Ghostty's default colors in the dark appearance and Claude Light's in
  the light one.
- **Quitting**: closing the window or quitting while sessions run asks first and says how many
  run; confirming ends them. A project cannot be removed from the list while one of its sessions
  runs; removing it closes its other sessions.
- **Window**: the window has no title bar. The sidebar and the shown session reach up to its top
  edge, where one row holds the window's traffic lights, the sidebar button, Back and Forward,
  and the session's header (in full screen, the buttons take the traffic lights' place); drag the
  window by the row's blank parts. Hide the sidebar with the sidebar button, ⌘B or **View > Hide
  Sidebar** to give the terminal the window's whole width; Hoot opens with the sidebar as you left
  it.
- The interface and the terminal follow the macOS light or dark appearance.

## Worktrees

Worktrees let several agents work on one project at the same time, each on a branch of its own in
a folder of its own.

- **Creating**: choose **New Worktree…** from a project's `+` menu or its context menu, enter the
  name of a new branch and pick the local branch it starts from. Hoot creates the branch and checks
  it out in a linked worktree in `~/.hoot/worktrees/<project>/<branch>` (with `/` and other
  characters that do not belong in a folder name replaced by `-`). An installed Hoot and one run
  from its repository use the same folders. Hoot does not start a session in the new worktree.
- **Nested repositories**: repositories inside the project that it ignores or does not track (such
  as the `hoot/` repository in Hoot's own workspace) get the same branch, at the same path inside
  the worktree, so that the worktree looks like the project. Each starts from its own base branch:
  by default the one named like the project's, or else the branch it has checked out. Leave out any
  of them in the dialog. Repositories in dependency folders such as `node_modules`, `vendor` or
  `.venv`, submodules and repositories reached through symbolic links are not included.
- **Submodules** are left empty in new worktrees, and the dialog lists them; run
  `git submodule update --init` in the worktree if you need them.
- **When Git complains**: if a hook such as `post-checkout` fails after Git has created a
  worktree, the worktree is kept and Hoot shows Git's output as a warning. If Git cannot create a
  worktree at all, Hoot removes what it created and shows Git's error.
- **In the sidebar**: a project's worktrees, the linked worktrees in its folder in
  `~/.hoot/worktrees`, are listed below the sessions of the project's main worktree, by branch, or
  by commit for a detached HEAD. Linked worktrees elsewhere, such as those coding agents make, are
  not listed. Point at a worktree to see its folder and its nested repositories. Its `+` starts a
  session in it, and its `⋯` menu or context menu reveals it in Finder, copies its path or deletes
  it. Sessions started in a worktree are listed below it, and the session header names the worktree
  after the project. A worktree whose folder is gone shows as Missing and can only be removed from
  Git's records; a locked worktree cannot be deleted.
- **Changes made outside Hoot**, by Git or by an agent, show when Hoot starts and when its window
  gets the focus; Hoot watches no files for them. Before starting a session in a worktree, deleting
  one or removing one, Hoot reads the worktrees again and goes ahead only if the worktree still
  allows it: a worktree that is gone allows nothing, a missing one only removing, a locked one no
  deleting, and one whose folder is back no removing.
- **Deleting**: Hoot checks every repository of the worktree, populated submodules included, for
  uncommitted changes and for commits that are on no branch, and looks for other repositories
  inside the worktree's folder, which would be deleted with it. Then it asks: when something would
  be lost, it lists it repository by repository, and deleting needs **Discard Changes and Delete**.
  Nested worktrees are deleted before the outer one. Branches are always kept. A worktree in which
  a session runs cannot be deleted.
- **Removing a project** from the list is not possible while a session runs in it or in any of its
  worktrees, and leaves its worktrees, their files and their branches as they are.

## Permission levels

The **Agents** menu in the menu bar picks, for each coding tool, which of the tool's own permission
modes its sessions start in. Until you pick another level, every tool starts at its highest level,
so agents do not stop to ask for permission. The new session menu shows each tool's level next to
its name.

| Tool        | Level                        | Arguments                                                 |
| ----------- | ---------------------------- | --------------------------------------------------------- |
| Claude Code | Bypass permissions (default) | `--dangerously-skip-permissions`                          |
|             | Auto                         | `--permission-mode auto`                                  |
|             | Accept edits                 | `--permission-mode acceptEdits`                           |
|             | Plan                         | `--permission-mode plan`                                  |
|             | Manual                       | `--permission-mode manual`                                |
| Codex       | Full Access (default)        | `--dangerously-bypass-approvals-and-sandbox`              |
|             | Default                      | `--sandbox workspace-write --ask-for-approval on-request` |
|             | Read Only                    | `--sandbox read-only --ask-for-approval on-request`       |
| OpenCode    | Auto-approve (default)       | `--auto`                                                  |
|             | Standard                     | none                                                      |

A level applies to the sessions that start after you pick it; running sessions are not affected.
Hoot does not check whether the installed version of a tool accepts these arguments: a tool that
rejects them exits with its own error message like any other process, and you can start a new
session after picking another level or updating the tool. Even at the highest level, Claude Code
and Codex still ask once whether you trust a folder they have not opened before.

## Requirements

- macOS 13 or later
- Node.js 24
- pnpm (the version pinned in `package.json` is used automatically through Corepack, which ships
  with Node.js)

## Getting started

```sh
pnpm install
pnpm build
pnpm start
```

`pnpm start` opens the built app through LaunchServices, the way Finder and the Dock do, and
without passing on the terminal's environment, so the app and its sessions start from your
graphical login session environment. Add `--background` (`pnpm start --background`) for unattended
checks: Hoot then starts without showing its window or coming to the front, and its window stays
off screen until you click its Dock icon.

The Electron binary is downloaded the first time it is needed. If downloads from GitHub are slow
where you are, point Electron at a mirror first, for example:

```sh
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
```

### Development

```sh
pnpm dev
```

starts Vite with hot reload and launches Electron from the current terminal. In this mode the app
inherits the terminal's environment, so use `pnpm start` to check environment-related behavior.

Runs from the repository (`pnpm start` and `pnpm dev`) keep their projects and settings apart from
an [installed](#installing) Hoot, so both can run at the same time.

## Installing

```sh
pnpm app:install
```

packages Hoot with electron-builder for your Mac's architecture and installs it as
`/Applications/Hoot.app`, replacing an earlier installation. `pnpm app:package` only packages it,
into `release/`.

If your keychain holds a "Developer ID Application" certificate, the app is signed with it, so
macOS keeps the permissions you grant Hoot (such as access to your Desktop folder) when you update
it. The first signing may ask you to allow `codesign` to use the certificate's key. The app is not
notarized, so it is meant for the Mac that built it.

To update, run `pnpm app:install` again, then quit Hoot and open it again. Until then, a running
Hoot keeps the version it started with. Quitting ends its sessions, and they are not restored.

## Checks

```sh
pnpm typecheck     # TypeScript 7 (tsc)
pnpm lint          # oxlint
pnpm format:check  # oxfmt
pnpm test          # Vitest unit tests
pnpm test:e2e      # builds, then runs the Playwright end-to-end tests against Electron
pnpm check         # all of the above
```

The end-to-end tests run each scenario in an isolated home directory with stand-in tool commands.
They never start the real coding tools and never send prompts to a model. While they run they use
the system clipboard (restoring its text afterwards) and keep the Hoot windows off screen, so they
never cover or take focus from the apps you are working in.

## Architecture

| Part     | Location       | Role                                                                                   |
| -------- | -------------- | -------------------------------------------------------------------------------------- |
| Main     | `src/main`     | Window, menu, projects, permission levels, tool detection, session processes, quitting |
| Pty host | `src/pty-host` | Electron utility process; the only place node-pty is loaded                            |
| Preload  | `src/preload`  | The `window.hoot` bridge between the renderer and the main process                     |
| Renderer | `src/renderer` | React 19, zustand, Tailwind CSS 4 and shadcn/ui (Base UI), xterm.js                    |
| Shared   | `src/shared`   | Types and messages used by more than one process                                       |

Everything is built by Vite 8 with `vite-plugin-electron`, which bundles every package except
node-pty, the only runtime dependency. Projects are stored in `projects.json`, and the permission
levels picked in the Agents menu and whether the sidebar is hidden in `settings.json`, in the app's
user data folder:
`~/Library/Application Support/Hoot` for the installed app, and
`~/Library/Application Support/Hoot-dev` for runs from the repository. Worktrees are read from
Git: a project's worktrees are the linked worktrees in its folder in `~/.hoot/worktrees`, whose
`.hoot-project.json` records the project it belongs to.
