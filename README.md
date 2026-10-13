# Hoot

Hoot is a desktop app for developers who use coding CLIs such as Claude Code, Codex and
OpenCode. Add local Git projects, then run coding tools and shells for them in terminals embedded in
the Hoot window, as many at a time as you like.

Hoot supports macOS. Hoot for Windows is a preview: for now it only opens its window, and adding
projects and starting sessions do not work yet.

## Features

- **Projects**: add a local Git repository by choosing any folder inside it (including a linked
  worktree, a submodule, or a repository whose Git directory is kept elsewhere). The project is the
  repository's main worktree, the working directory it was created with. Folders outside Git, bare
  repositories, and folders from which Git cannot tell where the main worktree is (such as a linked
  worktree of a repository whose Git directory is kept elsewhere) are refused. The list is kept
  across restarts. Right-click a project, or use its `⋯` menu, to remove it from the list (its
  files and its issues are never touched).
- **The project row**: a project's row in the sidebar shows its name, and how many of its
  [issues](#issues) are neither done nor canceled. Click it to expand or collapse the project: its
  sessions and [worktrees](#worktrees) are listed below it while it is expanded, and slide open and
  closed as it expands and collapses (or show and hide at once when macOS is set to reduce motion);
  a project with neither shows **No sessions** instead. Each project stays expanded or collapsed as
  you left it, also after Hoot quits; a project added to the list is expanded. Point at the row, or
  move the keyboard focus into it, to show its buttons: **Issues** shows the project's issues, `+`
  starts a session or creates a worktree, and `⋯` removes the project from the list.
- **Sessions**: start Claude Code (`claude`), Codex (`codex`), OpenCode (`opencode`) or your
  default shell in the project root, from the project's `+` button or its context menu, or in one
  of the project's [worktrees](#worktrees) from the worktree's `+` button. Tools run
  directly in your login shell environment, with only the arguments of their
  [permission level](#permission-levels) (a Claude Code session an issue is
  [sent to](#issues) also gets the issue); the shell runs as an interactive login shell. To the
  environment of each session's process Hoot adds the terminal's variables (`TERM`, `COLORTERM`,
  `TERM_PROGRAM` and `TERM_PROGRAM_VERSION`), and what [`hoot`](#the-hoot-command) needs: the
  variables `HOOT_SOCKET`, `HOOT_SESSION_ID`, `HOOT_NODE` and `HOOT_CLI`, and the folder `hoot` is
  in, first on `PATH`. Tools that are not installed are shown disabled with an install command, and
  **Re-detect Tools**, the last item of the new session menu, checks again at any time.
- **Many sessions at once**: any number of sessions can run at the same time, in the same project
  or in different ones. Each project lists its sessions below it in the sidebar while it is
  expanded, in the order they started, with the tool's icon (for Claude Code, its own mark), the
  session's name and its state: a green dot while it runs, or how it ended. Click a session to show
  it; the keyboard focus goes to its terminal. A collapsed project expands when one of its sessions
  is shown, however it is shown. Sessions that are not shown keep running, and their output is all
  there when you come back to them.
- **Names**: a session is named after the title its program gives the terminal (without the ✳, ◐
  or ◑ that Claude Code puts first), or after its tool until there is one. Double-click a session,
  or choose **Rename** from its context menu, to name it yourself: Enter saves, Esc cancels, and an
  empty name brings back the default one. Names last until Hoot quits.
- **Closing**: close a session with the button that appears when you point at it, the button in
  the session header, **Close** in its context menu, or **File > Close Session** (⌘W). Closing a
  running session asks first, then ends its process. When a session's process exits with code 0
  the session closes by itself; when it fails, is killed by a signal, or the terminal host stops,
  the session stays with its output and says how it ended, until you close it. When the shown
  session closes, the next one in the sidebar is shown, or the previous one after the last; when
  it was the only one, the page shown before it, if any.
- **Back and forward**: like a browser among pages, Hoot goes back and forward among the pages it
  has shown, sessions, [Issues pages](#issues) and the [settings](#settings) alike, with the arrow
  buttons at the top left, ⌘[ and ⌘] (**Window > Back** and **Forward**). Showing a page another
  way drops the pages you went back from. A page that is gone leaves the list: a session that
  closes, an issue that is deleted, and the Issues pages of a removed project.
  The list lasts until Hoot quits.
- **Shortcuts**: ⌘1 to ⌘9 show the first to ninth session in the sidebar (counting the sessions of
  collapsed projects too), ⌘⇧] and ⌘⇧[ (**Window > Select Next Session** and **Select Previous
  Session**) the next and previous one, ⌘[ and ⌘] go back and forward, ⌘W closes the shown
  session, ⌘B hides or shows the sidebar, and ⌘, shows the [settings](#settings). They work while a
  terminal or a text field has the focus and never reach the terminal's program or the field,
  whereas Ctrl+B reaches the program as usual (in an issue's description, ⌘B makes text bold). On
  an Issues page, where no session is shown, ⌘W closes nothing. Issues pages have
  [keys of their own](#issues). The window's close button and ⌘Q quit Hoot.
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
- **Window**: the window has no title bar. The sidebar and the shown page reach up to its top
  edge, where one row holds the window's traffic lights, the sidebar button, Back and Forward,
  and the session's header or the Issues page's title (in full screen, the buttons take the
  traffic lights' place); drag the window by the row's blank parts. Hide the sidebar with the sidebar button, ⌘B or **View > Hide
  Sidebar** to give the terminal the window's whole width; Hoot opens with the sidebar as you left
  it. On Windows, the sidebar button, Back and Forward start the row, and the window's minimize,
  maximize and close buttons end it, in the colors of the appearance in effect.

## Settings

**Settings** at the bottom of the sidebar, **Hoot > Settings…** or ⌘, shows the settings in place
of the sidebar and the shown page: their list on the left, as wide as the sidebar, and their page
on the right. The sidebar button and Back and Forward are not at the top left then: **Back to app**
at the top of the list, Esc (unless you are typing in a field or a dialog is open) and ⌘[ leave
them, showing the page shown before them and the sidebar as you left it; the
settings are a page among the others for going [back and forward](#features). When no page was shown before
them, leaving them shows the empty page and takes them out of the list. While they are shown,
sessions keep running, ⌘1 to ⌘9 and ⌘⇧] and ⌘⇧[ show sessions, **File > Add Project…** adds a
project, and ⌘W and ⌘B do nothing. Changes apply at once; there is nothing to save.

- **Appearance**: pick **System**, **Light** or **Dark**, each drawn as a small Hoot window. The
  interface, every terminal (also of the sessions not shown), the window itself, and the menus,
  dialogs and panels macOS draws for Hoot change to it at once. **System**, until you pick another,
  follows the macOS light or dark appearance, also when macOS changes it while Hoot runs;
  **Light** and **Dark** stay as they are whatever appearance macOS uses. Hoot opens in the
  appearance picked from its first frame, also when it can only show that its database cannot be
  opened. Click a card, or move to the cards with Tab and pick one with ← and →.

## Issues

Note what to do in a project, such as an idea you have or a problem you notice while an agent
works, as an issue, and come back to it later. Issues are kept on your Mac, in
[Hoot's database](#architecture).

- **The list**: the **Issues** button of a project's row in the sidebar, which shows while you point
  at the row, shows the project's issues, laid out as in Linear; the row shows how many of them are
  neither done nor canceled, and is selected while one of the project's Issues pages is shown.
  **All issues**, **Active** (to do or in progress) and **Backlog** show those issues, grouped by
  status: In Progress, Todo, Backlog, Done and Canceled, the closest to done first. Each group
  lists its issues by priority, urgent first and those without one last, then newest first; done
  and canceled issues are listed the most recently completed first. A row shows the issue's
  priority, its identifier (the first three letters or digits of the project's name and its
  number, such as `HOO-12`), its status, its title and the day it was created. Click a group's
  header to collapse or expand it, or its `+` to create an issue with its status. Each project's
  list shows the view and the collapsed groups as you left them, until Hoot quits. Click an issue
  to show its page; right-click it to change its status or priority, copy its identifier or title,
  or delete it.
- **New issues**: **New issue** at the top right of the list, or C, opens a dialog for the
  project's new issue: a title, which an issue needs, a description, a status (Backlog unless you
  pick another) and a priority. **Create issue** (⌘ Enter) creates it, without the spaces around
  its title, and says so, with **View issue** to show it; ⌘⌥ Enter creates it and shows it. With
  **Create more** on, the dialog stays for the next issue, keeping the status and the priority.
  An issue's number in its project is never given again, not even after it is deleted.
- **An issue's page** shows its title and description, with its status and priority beside them
  (under the title when the window is narrow), and when it was created and completed. Edit the
  title and the description where they show; they are saved as you type. The description is
  formatted as you type GitHub Flavored Markdown (`# `, `- `, `1. `, `[ ] `, `**bold**`,
  `` `code` `` and the like) and kept as Markdown: headings, lists, code, task lists, tables and
  links. Showing a description never changes it; a description you edit is saved as the editor
  writes Markdown, which may differ from how it was written (`*` lists become `-` lists, for
  instance). HTML in a description makes no elements except formatting such as bold, and runs
  nothing. Links to `http` and `https` addresses open in your default browser when clicked; other
  links open nothing. Tick a task list's box to change it. In the description, ⌘B makes text bold
  rather than hiding the sidebar. Click a status or priority to change it, or **Issues** in the
  title row to go back to the list. The arrows at the top right show the next and previous issue
  of its list, and the `⋯` menu copies the issue's identifier or title, or deletes the issue for
  good, after asking.
- **Keys**: on an Issues page, unless you are typing in a field or the description, or a menu or
  dialog is open: C opens the new issue dialog; J and K (and on a list ↓ and ↑) move to the next
  and previous issue; Enter shows the issue moved to on a list; S and P change the status and the
  priority, in a picker where you can search or press the value's digit; ⌘⌫ deletes, after
  asking; and Esc on an issue's page goes back to its list.
- **Sending to Claude Code**: before handing an issue to an agent, find out whether it is too big
  and how to split it. **Send to Claude Code**, above the title of an issue that is neither done nor
  canceled, saves what you typed in it, then starts Claude Code in a new session in the project root
  (never in a worktree), at the permission level picked in the Agents menu, and shows it. Hoot
  writes the issue, its title as a heading and its description below it, to `issue.md` in a new
  folder of the session's own in the system's temporary folder, and adds that folder to Claude
  Code's working directories (`--add-dir`), so that Claude Code reads the file without asking at
  any permission level. The session is named after the issue's title, and its first message is
  Hoot's instructions, which point to the file: they ask the agent to read the code without
  changing anything and to judge whether one fresh agent session can implement the issue and
  another verify it in full; if not, to split it into ordered issues that can each be accepted on
  its own, each with a title, a description and the issues it waits on. The instructions would do
  for any agent, and the issue stays out of the message, where an agent could take some of its text
  for a command or a mention. Hoot does not enforce that nothing changes: like any other session,
  this one can change files as far as its permission level lets it. The answer stays in the
  conversation, where you can go on with it. Hoot removes the issue's folder once the session's
  process has ended, or when it could not start; if Hoot stops without quitting, the folder stays
  until macOS clears its temporary files. Nothing is written to `~/.claude`, `~/.claude.json` or
  the project. While the session is in the sidebar, the button is **Show Claude Code Session** and
  always shows it; once the session is closed, the button sends the issue again. Sending is not
  possible while Hoot is still checking whether Claude Code is installed, or when it is not
  installed; the button's tooltip then says why. NUL characters are left out of what is sent.
- **Drafts**: what you enter in a project's new issue dialog stays when the dialog closes (with
  Esc, its close button, or by showing another page), until you create the issue, remove the
  project, or quit Hoot. Quitting does not ask about drafts.
- **Removing a project** from the list keeps its issues; they come back, done and canceled ones
  included, with their numbers, when you add the project again.

## The hoot command

In every session Hoot starts, `hoot`, Hoot's command line program, reads and creates the issues of
the session's project, with commands modeled on `gh issue`. It works with the Hoot that started the
session and the project the session belongs to (also when it runs in one of the project's
worktrees), whatever the current folder, and whichever other Hoots run at the same time, such as an
installed one and one run from its repository.

```sh
hoot issue view HOO-12         # or by its number: hoot issue view 12
hoot issue list                # the issues neither done nor canceled
hoot issue list --status todo --status in-progress
hoot issue create --title "Fix the login bug" --description-file notes.md --priority high
```

- **`hoot issue view <issue>`** shows an issue, given its identifier (such as `HOO-12`) or its
  number (`12`): its identifier and title; then its status, its priority and when it was created
  (in local time, to the minute); then, if it has a description, a blank line and the description
  as it is written, in Markdown.
- **`hoot issue list`** lists the project's issues that are neither done nor canceled, one per
  line with its identifier, status, priority and title, in the order of the project's **All
  issues** list. `--all` lists every issue, and `--status <name>`, given once for each status,
  only the issues with those statuses, done or not.
- **`hoot issue create --title <title>`** creates an issue in the project, and prints its
  identifier. Its description is `--description <text>`, or what the UTF-8 file
  `--description-file <file>` holds (`-` reads standard input), exactly as given, or none; its
  status is `--status <name>`, `backlog` unless given; its priority `--priority <name>`, `none`
  unless given. Otherwise it is created as the new issue dialog creates one: its title on one
  line, each line break a space, and without the whitespace around it; with the project's next
  number; and completed as it is created when it is done or canceled.
- **Names**: the statuses are `backlog`, `todo`, `in-progress`, `done` and `canceled`; the
  priorities `none`, `urgent`, `high`, `medium` and `low`.
- **`--json`** prints the issue, or the list as an array, as JSON objects with exactly
  `identifier`, `number`, `title`, `description`, `status`, `priority`, `createdAt` and
  `completedAt`, the times in UTC in ISO 8601, `completedAt` being `null` while the issue is
  neither done nor canceled. `hoot --help` and `hoot issue --help` explain all of this.
- **In the window**, an issue `hoot` creates shows at once: in its project's count in the sidebar,
  on the project's Issues pages, and among the issues an issue's page steps through. Nothing else
  changes there: no message pops up, the page, the sidebar and the keyboard focus stay as they
  are, and so does what you are typing. Hoot does not record that `hoot`, or which session,
  created an issue.
- **When it cannot** do what it is asked, `hoot` says why on standard error and exits with code 1,
  without creating anything: when the issue is not in the project, a name, option or command is
  wrong, the Hoot that started the session is not running any more, or it does not run in a session
  Hoot started.
- **Agents** are not told about `hoot`, and it is not allowed in advance: a coding tool runs it like
  any other command, at its [permission level](#permission-levels), and Hoot changes no tool's
  settings for it. At Codex's **Default** and **Read Only** levels, Codex's sandbox may block
  `hoot`'s connection to Hoot, and `hoot` then says so: let it run outside the sandbox, as Codex
  offers to with your approval, or pick **Full Access**.

Hoot listens for `hoot` on a Unix domain socket that only you can connect to, `hoot.sock` in its
[user data folder](#architecture) (or in the system's folder for temporary files when that path is
too long for a socket). Each session's process gets in its environment:

| Variable          | Value                                                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `PATH`            | First, the folder `hoot` is in: `Hoot.app/Contents/Resources/bin`, or `resources/bin` in the repository for a Hoot run from it |
| `HOOT_SOCKET`     | The socket of the Hoot that started the session                                                                                |
| `HOOT_SESSION_ID` | The session's id, by which that Hoot knows the session's project                                                               |
| `HOOT_NODE`       | Hoot's own executable, which runs `hoot` as Node.js                                                                            |
| `HOOT_CLI`        | `hoot`'s script, inside Hoot                                                                                                   |

A login shell may move that folder further down `PATH` (macOS's `/etc/zprofile` and fish put the
system's folders first); `hoot` is still found by its name, unless another program named `hoot`
comes before it. On Windows, where Hoot cannot start sessions yet, Hoot would listen on a named
pipe, and cmd and PowerShell would run `hoot.cmd`, and Git Bash `hoot`, both in that folder.

## Worktrees

Worktrees let several agents work on one project at the same time, each on a branch of its own in
a folder of its own.

- **Creating**: choose **New Worktree…** from a project's `+` menu or its context menu, enter the
  name of a new branch and pick the local branch it starts from. Hoot creates the branch and checks
  it out in a linked worktree in `~/.hoot/worktrees/<project>/<branch>` (with `/` and other
  characters that do not belong in a folder name replaced by `-`). An installed Hoot and one run
  from its repository use the same folders. Hoot does not start a session in the new worktree; it
  expands the project, if it was collapsed, to show the worktree's row.
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

Runs from the repository (`pnpm start` and `pnpm dev`) keep their projects, issues and settings apart from
an [installed](#installing) Hoot, so both can run at the same time.

## Installing

Download Hoot from the [releases](https://github.com/Levix0501/hoot/releases) on GitHub. Its
versions are prereleases for now.

- **Mac**: take the DMG for your Mac's chip, `arm64` for Apple Silicon or `x64` for Intel. Open it
  and drag Hoot to Applications. Hoot is signed and notarized, so it opens like any other app.
- **Windows**: Hoot for Windows is a preview. For now it only opens its window: adding projects and
  starting sessions do not work yet. Run the installer (`Hoot-Setup-<version>.exe`): it installs
  Hoot for you alone, in `%LOCALAPPDATA%\Programs\Hoot`, without asking anything. The installer is
  not signed, so Microsoft Defender SmartScreen may say "Windows protected your PC": click **More
  info**, then **Run anyway**. It cannot be installed on a PC with Smart App Control turned on.

### From source

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

## Releasing

Every change that users of Hoot would notice comes with a changeset: a Markdown file in
`.changeset/` that says how it changes the version (`patch`, `minor` or `major`) and what changed,
for users. Write it with

```sh
pnpm changeset
```

which asks for the kind of change and its summary, and commit it with the change. Its summary
becomes the change's entry in `CHANGELOG.md` and in the release's text. Hoot is in Changesets'
prerelease mode, so versions are alpha prereleases (`0.1.0-alpha.0`, then `0.1.0-alpha.1` and so
on) until `pnpm changeset pre exit`.

A release takes these steps:

1. Push to `main`. The release workflow (`.github/workflows/release.yml`) runs `pnpm check` and,
   while there are changesets that no version has taken yet, opens a pull request named
   "chore(release): version packages (alpha)", or updates it. It holds the new version in
   `package.json` and its section in `CHANGELOG.md`.
2. Merge that pull request. The workflow tags the merge `v<version>`, builds the installers, signed
   and notarized for the Mac, and drafts a release for the tag with them: marked as a pre-release
   for a prerelease version, with the version's section of `CHANGELOG.md` and how to install Hoot
   as its text.
3. Check the draft on GitHub's Releases page and publish it. The workflow never publishes a
   release.

The workflow uses only the token GitHub gives each run, which may open pull requests once
**Settings > Actions > General > Allow GitHub Actions to create and approve pull requests** is on.
It signs and notarizes the Mac apps with these repository secrets:

| Secret                              | What it holds                                                                    |
| ----------------------------------- | -------------------------------------------------------------------------------- |
| `DEVELOPER_ID_CERTIFICATE_BASE64`   | Your "Developer ID Application" certificate and its key, as a base64 `.p12` file |
| `DEVELOPER_ID_CERTIFICATE_PASSWORD` | The password the `.p12` file was exported with                                   |
| `APP_STORE_CONNECT_API_KEY`         | The contents of an App Store Connect API key's `.p8` file                        |
| `APP_STORE_CONNECT_API_KEY_ID`      | That key's Key ID                                                                |
| `APP_STORE_CONNECT_API_ISSUER_ID`   | Its Issuer ID                                                                    |

- **The certificate**: in Keychain Access, under **My Certificates**, select "Developer ID
  Application: …" with its private key, choose **File > Export Items…**, save it as a `.p12` file
  and give it a password.
- **The API key**: in App Store Connect, under **Users and Access > Integrations > App Store Connect
  API**, generate a team key (the Developer role is enough). Download its `.p8` file, which can be
  downloaded only once, and note its Key ID and the Issuer ID above the list of keys.

Store them with the GitHub CLI:

```sh
base64 -i DeveloperID.p12 | gh secret set DEVELOPER_ID_CERTIFICATE_BASE64
gh secret set DEVELOPER_ID_CERTIFICATE_PASSWORD
gh secret set APP_STORE_CONNECT_API_KEY < AuthKey_<Key ID>.p8
gh secret set APP_STORE_CONNECT_API_KEY_ID --body "<Key ID>"
gh secret set APP_STORE_CONNECT_API_ISSUER_ID --body "<Issuer ID>"
```

To try a build without releasing anything, run the workflow from the repository's **Actions** page:
choose **Release**, then **Run workflow** and a branch. It checks and builds the installers, which
the run keeps as its artifacts, and changes nothing else: no tag, release, pull request or commit.

### Building the installers on a Mac

```sh
pnpm app:release
```

builds in `release/` what a release ships: a DMG and a zip of Hoot for Apple Silicon (`arm64`) and
for Intel (`x64`), signed and notarized; the Windows installer; and the update files that list them
(`<channel>-mac.yml` and `<channel>.yml`, the channel being the version's prerelease tag, such as
`alpha`). It needs Xcode 26 or later, which compiles the Mac icon, and a "Developer ID Application"
certificate in your keychain. It notarizes with the credentials stored in your keychain under the
profile `hoot-notary` (another profile can be named in `APPLE_KEYCHAIN_PROFILE`). Store them once,
for example with an App Store Connect API key:

```sh
xcrun notarytool store-credentials hoot-notary --key AuthKey_<Key ID>.p8 --key-id "<Key ID>" --issuer "<Issuer ID>"
```

## Checks

```sh
pnpm typecheck     # TypeScript 7 (tsc)
pnpm lint          # oxlint
pnpm format:check  # oxfmt
pnpm test          # Vitest unit tests
pnpm check         # all of the above
```

To check a change in the running app, drive the built app with Playwright's Electron support
(`_electron.launch`). Give it a temporary `--user-data-dir` so that it keeps its own projects,
issues and settings, and `--background` so that its window stays off screen. With `--test-hooks`
the page also exposes the sessions' terminals as `window.hootTestHooks`.

With `--windows-layout` (for example `pnpm start --windows-layout`), Hoot leaves an empty area as
wide as the window's buttons on Windows, 140 pixels, at the right end of the window's top row, as
it does on Windows: it shows on a Mac whether anything in the row would be covered there.

## Architecture

| Part     | Location       | Role                                                                                                                       |
| -------- | -------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Main     | `src/main`     | Window, menu, database, projects, issues, permission levels, tool detection, session processes, quitting, answering `hoot` |
| Pty host | `src/pty-host` | Electron utility process; the only place node-pty is loaded                                                                |
| Preload  | `src/preload`  | The `window.hoot` bridge between the renderer and the main process                                                         |
| Renderer | `src/renderer` | React 19, zustand, Tailwind CSS 4 and shadcn/ui (Base UI), xterm.js                                                        |
| Shared   | `src/shared`   | Types and messages used by more than one process                                                                           |
| hoot     | `src/cli`      | The [`hoot` command](#the-hoot-command), which Hoot's executable runs as Node.js; its launchers are in `resources/bin`     |

Everything is built by Vite 8 with `vite-plugin-electron`, which bundles every package except
node-pty, the only runtime dependency. Hoot keeps its data in the app's user data folder:
`~/Library/Application Support/Hoot` for the installed app, and
`~/Library/Application Support/Hoot-dev` for runs from the repository.

- The projects and their issues are in a SQLite database, `data/hoot.db`, which Hoot reads and
  writes with Node's built-in `node:sqlite`, in plain SQL. Its tables' version is its
  `PRAGMA user_version`; on opening it, Hoot applies the migrations in `src/main/database`
  after that version, all in one transaction. The second one gave issues Linear's statuses
  (open issues became to do, closed ones done), priorities and numbers; a Hoot from before it
  cannot open the database afterwards. The project list used to be kept in `projects.json`, which
  is no longer read: add your projects again.
- If the database cannot be used when Hoot starts (it is not a database, cannot be read, written
  or created, was written by a newer Hoot, or cannot be upgraded), the window shows only why and
  where the file is, with **Show in Finder** and **Quit**, and Hoot leaves the file as it is.
- The permission levels picked in the Agents menu, whether the sidebar is hidden, which projects in
  it are collapsed, and the appearance picked in the settings are in `settings.json`.

Worktrees are read from Git: a project's worktrees are the linked worktrees in its folder in
`~/.hoot/worktrees`, whose `.hoot-project.json` records the project it belongs to.

Icons come from [lucide](https://lucide.dev), except brand marks, which Hoot keeps as SVG files of
its own in `src/renderer/assets/brand-icons`: Claude Code's is copied from Anthropic's Claude Code
extension for VS Code, with its color replaced by the color of the text around it.

## License

Hoot is released under the MIT License. The Claude Code icon
(`src/renderer/assets/brand-icons/claude-code.svg`) is a trademark of Anthropic and is not covered
by Hoot's MIT License.
