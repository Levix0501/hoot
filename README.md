# Hoot

Hoot is a desktop app for developers who use coding CLIs such as Claude Code, Codex and
OpenCode. Add local projects, then run coding tools and shells for them in terminals embedded in
the Hoot window, as many at a time as you like.

Hoot supports macOS. Hoot for Windows is a preview: it adds projects, starts sessions, and installs
and updates [agents](#agents) with the npm of the computer's Node.js.

## Features

- **Projects**: add any folder as a project. A folder in a Git repository (including a linked
  worktree, a submodule, or a repository whose Git directory is kept elsewhere) adds the
  repository: the project is its main worktree, the working directory it was created with. A folder
  outside Git is a project as it is, without [worktrees](#worktrees). Bare repositories, and folders
  from which Git cannot tell where the main worktree is (such as a linked worktree of a repository
  whose Git directory is kept elsewhere), are refused. The list is kept across restarts.
  Right-click a project, or use its `⋯` menu, to remove it from the list (its files and its issues
  are never touched).
- **The project row**: a project's row in the sidebar shows its name, and how many of its
  [issues](#issues) are neither done nor canceled. While the project is collapsed, a light right of
  its name shows the state of its sessions that needs you most (in its main worktree and its
  worktrees alike), in this order: Waiting for you, Ended unexpectedly, Stopped by an error, Ended,
  Done; pointing at it counts the sessions in each, such as "2 sessions waiting for you, 1 session
  done". Click it to expand or collapse the project: its sessions and [worktrees](#worktrees) are
  listed below it while it is expanded, and slide open and closed as it expands and collapses (or
  show and hide at once when macOS is set to reduce motion); a project with neither shows **No
  sessions** instead. Each project stays expanded or collapsed as you left it, also after Hoot
  quits; a project added to the list is expanded. Point at the row, or move the keyboard focus into
  it, to show its buttons: **Issues** shows the [issue list](#issues) with only the project checked
  in its **Project** dropdown (leaving the project expanded or collapsed), `+` starts a session or
  creates a worktree, and `⋯` removes the project from the list.
- **Sessions**: start Claude Code (`claude`), Codex (`codex`), OpenCode (`opencode`) or your
  default shell in the project root, from the project's `+` button or its context menu, or in one
  of the project's [worktrees](#worktrees) from the worktree's `+` button. Tools run
  directly in your login shell environment (on Windows, in the one Hoot started with, which
  Windows gives every app), with only the arguments of their
  [permission level](#permission-levels) (a Claude Code session
  [started from an issue](#issues) also gets the issue); the shell runs as an interactive login shell
  (on Windows, the shell is PowerShell: PowerShell 7 when it is on `Path`, or else the Windows
  PowerShell that comes with Windows). Claude Code also gets, with `--settings`, the hooks that
  tell Hoot what it is doing (see **Session lights**), on top of your own hooks. A tool's command
  is the first on your login shell's `PATH`; Hoot looks for them when it starts. On Windows, where
  the command npm or pnpm installs is a batch file, the session starts what it points to instead,
  the agent's program or its script with Node.js, so that `cmd.exe` never reads the arguments. To
  the environment of each session's process Hoot adds the terminal's variables (`TERM`,
  `COLORTERM`, `TERM_PROGRAM` and `TERM_PROGRAM_VERSION`) and what [`hoot`](#the-hoot-command)
  needs: the variables `HOOT_SOCKET`, `HOOT_SESSION_ID`, `HOOT_NODE` and `HOOT_CLI`, and the
  folder `hoot` is in, first on `PATH`. Tools that are not
  installed are shown disabled, with **Install in Settings…** below them, which shows the
  [Agents](#agents) page, and **Re-detect Tools**, the
  last item of the new session menu, looks for them again at any time (on Windows, in the folders
  `Path` had when Hoot started).
- **Many sessions at once**: any number of sessions can run at the same time, in the same project or
  in different ones. Each project lists its sessions below it in the sidebar while it is expanded,
  in the order they started, each with the light of its state, the tool's own icon and the session's
  name. Click a session to show it; the keyboard focus goes to its terminal. A collapsed project
  expands when one of its sessions is shown, however it is shown. Sessions that are not shown keep
  running, and their output is all there when you come back to them.
- **Session lights**: left of a session's icon, a light shows its state, which the light names when
  you point at it, and the session header shows the same light with the name beside it. Every
  session is **Starting** (a gray spinner) until its process runs, and once it has ended **Ended**
  (a gray ring; the tooltip says how it ended, and the header says it briefly, such as "Exited
  (1)"), or **Ended unexpectedly** (a red dot) when the terminal host stopped. While it runs, a
  Codex, OpenCode or shell session is **Running** (a green dot), and a Claude Code session is
  **Working** (a spinner) while it works on a message, **Waiting for you** (an amber dot) while it
  asks you to approve a tool call or a plan, asks you a question, or shows an MCP server's request
  for input (also for one of its background agents), **Stopped by an error** (a red dot) after an
  API error ends a turn, until the next one starts (your next message, or Claude taking the news
  that a background agent is done; meanwhile a background agent that still works or asks you
  something shows first, and a background agent's own API error ends no turn), **Done** (a blue
  dot) when it stopped working while you were not looking, until you look, and **Idle** (a green
  dot) otherwise. You are looking at a session while it is shown and Hoot's
  window is the active one. Waiting for you and Stopped by an error come from hooks that Hoot adds
  to every Claude Code session it starts: they run `hoot` in the background, print nothing and
  decide nothing. Your own hooks still run, and with
  `"disableAllHooks": true` in your settings, neither yours nor Hoot's run, and those sessions show
  only Working, Done and Idle. With macOS set to reduce motion, spinners stand still.
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
  way drops the pages you went back from. The issue list is one page, whatever is checked in its
  **Project** dropdown, which it shows as checked when you come back to it. A page that is gone
  leaves the list: a session that closes, an issue that is deleted, and the pages of a removed
  project's issues (the issue list stays). The list lasts until Hoot quits.
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
- **Quitting**: closing the window or quitting while sessions run, or while agents are being
  [installed or updated](#agents) or wait to be, asks first, and says how many sessions run and
  which agent is being installed or updated; confirming stops those installs and updates (the one
  running is sent SIGTERM, and Hoot waits for it to end; any asked for after that is cancelled at
  once), then ends the sessions. A project cannot be removed from the list while one of its
  sessions runs; removing it closes its other sessions.
- **Window**: the window has no title bar. The sidebar and the shown page reach up to its top
  edge, where one row holds the window's traffic lights, the sidebar button, Back and Forward,
  and the session's header or the Issues page's title (in full screen, the buttons take the
  traffic lights' place); drag the window by the row's blank parts. Hide the sidebar with the sidebar button, ⌘B or **View > Hide
  Sidebar** to give the terminal the window's whole width. Drag the sidebar's right edge to make
  it 240 to 520 pixels wide (a narrow window narrows it to leave the shown page at least 240), or
  narrower than 120 to hide it; double-click the edge for its default width, 275. Hoot opens with
  the sidebar as you left it. On Windows, the sidebar button, Back and Forward start the row, and
  the window's minimize, maximize and close buttons end it, in the colors of the appearance in
  effect.

## Settings

**Settings** at the bottom of the sidebar, **Hoot > Settings…** or ⌘, shows the settings in place
of the sidebar and the shown page: their list on the left, as wide as the sidebar, and their page
on the right: **Appearance**, **Agents**, **Labels** and **About**. Click one to show it; the settings show
the page shown last whenever they are shown again (Appearance, after Hoot starts), and
**Install in Settings…** in the new session menu always shows Agents. Switching between their
pages is not a step for going back and forward. The sidebar button and Back and Forward are not at
the top left then: **Back to app**
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
- **Labels**: as Linear's label settings, every label of the [issues](#issues) and every group of
  labels, the labels without a group and the groups by name, each group's labels under it. A row
  shows the label's color, name and description, and how many issues have it. **New label** and
  **New group** create one; a label has a name no other label has, whatever its case, a color
  (one of Hoot's, or any six hexadecimal digits) and a description, which may be empty, and can be
  put in a group. Pointing at a row shows the buttons that edit the label (its name, color,
  description and group: moved into a group, to another, or out of any) or delete it, and a group's
  row the one that deletes the group. What cannot be done is not done, and Hoot says why: a name
  another label has, or a move after which an issue would have two labels of a group. Deleting a
  label asks first, saying how many issues have it, and takes it off every one of them, those of
  projects removed from the list too; their activity keeps the entries of it as it was written
  then, and gets none for the deletion. Deleting a group keeps its labels, without a group, on the
  issues that have them. The group of the [workflow](#issues), **Spec-driven**, and its labels are
  listed too, with a lock: they can only be given to issues and taken off them, and nothing on the
  page changes them, deletes them, or moves another label into their group.

### Agents

The **Agents** page lists Claude Code, Codex and OpenCode. Each row shows the agent's
version, how it was installed (**npm**, **Homebrew** or **Official installer**) and its command's
path (with `~` for your home folder, cut in the middle when it is long, and in full when you
point at it); or **Not installed** and where **Install** would put it. On the right it says
**Up to date**, offers **Install** or **Update to** the latest version, or says **Checking…**,
**Couldn't check for updates**, **Update it the way you installed it**, or
**Installed, but it doesn't run** (click it to see what the command wrote for `--version`). Where
the computer has no npm that runs, it says **Install needs Node.js and npm** instead of
**Install**: install Node.js, which comes with npm, and the page offers it. Where npm runs but
you cannot create files in its global folder, such as one that belongs to root, it says
**Install needs write access to npm's folder**, and the row names the folder. Where the agent's
latest version runs on Node.js (its command is a JavaScript file, as Codex's is; Claude Code's and
OpenCode's are programs of their own) and needs a newer Node.js than the first `node` on your login
shell's `PATH`, the one its sessions would run it with, it says **Install needs Node.js** and the
versions, such as **Install needs Node.js 22.19.0 or later**, and the row says which version yours
is. Showing the page, and **Re-detect** at its top right, read your login shell environment again,
look for each agent (the first on its `PATH`, the one sessions run), run it with `--version`, and
read the latest version.
The latest version is the one the `latest` tag names on registry.npmjs.org, whatever registry your
npm uses, with the Node.js versions it needs (its package's `engines` field) and whether its command
is a JavaScript file (its `bin` field); Hoot asks registry.npmjs.org only then, never in the
background.

- **Install** installs the npm package's latest version (`@anthropic-ai/claude-code`,
  `@openai/codex`, `@opencode/cli`) with your npm, never with an agent's install script. When the
  first `npm` on your login shell's `PATH` runs and you can create files in its global folder's
  `lib/node_modules` and `bin` (on Windows, its `node_modules` and the global folder itself), Hoot
  runs `npm install -g <package>@latest` with it, as you would in a terminal, so the agent works in
  your terminals too. Pointing at **Install** shows the command it runs, such as
  `Runs ~/.nvm/versions/node/v24.15.0/bin/npm install -g @openai/codex@latest --loglevel=http`.
  npm only warns about a Node.js that a package's `engines` field does not allow, so Hoot checks
  it first, as above. Hoot comes with no npm or Node.js of its own, and changes none of your
  shell's configuration files.
- **Update to** updates the installation the row shows, in its place, the way it was
  installed: `npm install -g <package>@latest` with the npm of its global folder,
  `brew upgrade --cask` or `--formula` for the cask or formula it
  comes from, or the agent's own update command for its official installer (`claude update`,
  `codex update`, `opencode upgrade`). Hoot cannot update an agent installed any other way, and
  says so. Pointing at **Update to** shows the command it runs. For an installation by npm, Hoot
  first checks that you can create files in its global folder and, where the latest version runs
  on Node.js, that it does on your `node`; where either does not hold, the row says the latest
  version **is out** instead of offering **Update to**, and the line below the agent's name says
  why: **npm's folder isn't writable**, such as one installed with `sudo npm`, or which Node.js the
  version needs and which version yours is. It never uses `sudo` or changes the owner or
  permissions of a file: an installation by Homebrew or an official installer that you are not
  allowed to change fails with the command's own error message. Running sessions go on with the
  version they started with, and the result says how many still do; sessions started afterwards
  run the new version.
- **Progress and results**: while it runs, the row shows **Installing…** or **Updating…** and the
  last line the command wrote. Installs and updates run one at a time, in the order you clicked
  them: the others say **Waiting…**. **Cancel** takes a waiting one off the list, or sends the
  running command SIGTERM, once, and waits for it to end: npm first finishes the step under way,
  such as a download, then puts back what it changed, leaving the agent as it was. The result
  stays in the row until the agent's next install or update, or until Hoot quits: **✓ Installed**
  or **✓ Updated to** and the version, **Cancelled**, or why it failed, with the last lines the
  command wrote and **Show output** for all of them. Installing succeeds when the command exits
  with 0 and the agent is found and runs afterwards; updating, when it also stays at the same path
  with a newer version. Afterwards Hoot looks for the agent again, and the new session menu has it
  at once, without restarting Hoot.
- npm uses your npm configuration (such as the registry and the proxy in `~/.npmrc`); Hoot adds
  none of its own.

Leaving the page or the settings does not stop an install or an update.

## Issues

Note what to do, such as an idea you have or a problem you notice while an agent works, as an
issue, in one of your projects or, while you do not know which one yet, in none, and come back to
it later. Issues are kept on your Mac, in [Hoot's database](#architecture).

- **Where they are**: the **Issues** row at the top of the sidebar, above the projects, shows the
  issue list, with what is checked in its **Project** dropdown as you left it, and how many issues
  are neither done nor canceled (those of the projects in the list, and those without a project).
  The **Issues** button of a project's row, which shows while you point at the row, shows the list
  with only that project checked; the row shows how many of the project's issues are neither done
  nor canceled. The **Issues** row is selected while the list or an issue's page is shown; the
  project rows are not.
- **The list** shows the issues laid out as in Linear. **All issues**, **Active** (to do or in
  progress) and **Backlog** show them grouped by status: In Progress, Todo, Backlog, Done and
  Canceled, the closest to done first. Each group lists its issues by priority, urgent first and
  those without one last, then newest first; done and canceled issues are listed the most recently
  completed first. A row shows the issue's priority, its identifier (such as `ISS-12`), its status,
  its title, followed by its [labels](#issues), each with its color, how many issues it waits on (a red blocked icon and the count) and
  how many wait on it (a blocking icon and the count; see [Dependencies](#issues)), the name of its
  project if it has one, and the day it was created, and ends with the [start button](#issues) of
  an issue that is neither done nor canceled. Click a group's header to collapse or expand it, or
  its `+` to create an issue with its status. Click an issue to show its page; right-click it to
  change its status, priority or project, start a new session for it (see Starting again below),
  copy its identifier or title, give it a parent or sub-issues or take it from its parent (see
  [Sub-issues](#issues)), mark it as blocked by an issue or blocking one, or delete it.
- **The Project dropdown**, at the right end of the row of views, picks whose issues the list
  shows. Check any of its choices, **No project** and the projects (in the sidebar's order), to
  show only the issues of those checked: the issues without a project while **No project** is
  checked, and those of each project checked. With nothing checked, which it says as
  **All projects**, the list shows every issue. It names what is checked, or says how many
  (such as **2 projects**); type in its search field to list only the choices whose names match.
  A project removed from the list leaves it. The view and the collapsed groups are the same
  whatever is checked; they and what is checked stay as you left them until Hoot quits, which
  starts the list again with nothing checked, all issues shown and every group expanded.
- **The Label filter**, beside the Project dropdown, shows only the issues with the labels checked
  in it: **Has any of** them, as it starts, or **Has all of** them, which the choice beside it
  switches between once a label is checked. It names the label checked, or says how many (**All
  labels** with none checked, which shows every issue); type in its search field to find a label.
  It works together with the Project dropdown and the view, and forgets a label once it is deleted.
- **Numbers**: each new issue gets the next number, `ISS-1`, `ISS-2` and on, counted across all
  issues, those without a project and those of removed projects included. An issue keeps its
  number when it moves to another project or out of one, and a number is never given again, not
  even after its issue is deleted.
- **New issues**: **New issue** at the top right of the list, or C, opens a dialog for a new issue:
  a title, which an issue needs, a description, a status (Backlog unless you pick another), a
  priority, and a project, which the **Project** button picks (it says **Project** for none).
  While the title and the description are empty, opening the dialog sets the project: on the
  list, to the project checked in the dropdown when that is all that is checked, and otherwise to
  none; on an issue's page, to that issue's project, or none. **Create issue** (⌘ Enter)
  creates it, without the spaces around its title, and says so, such as **ISS-12 created**, with
  **View issue** to show it; ⌘⌥ Enter creates it and shows it. With **Create more** on, the dialog
  stays for the next issue, keeping the status, the priority and the project. An issue without a
  project can be created also while no project is in the list.
- **An issue's page** shows its title and description, with its status, priority, project and
  labels, and the issues it is blocked by and those it blocks, beside them (under the title
  when the window is narrow), and its activity; above
  them stands the start button of an issue that is neither done nor canceled. Its title row says
  **Issues ›**, the issue's identifier and its title. Edit the title and the description
  where they show; they are saved as you type. The description is formatted as you type GitHub
  Flavored Markdown (`# `, `- `, `1. `, `[ ] `, `**bold**`, `` `code` `` and the like) and kept as
  Markdown: headings, lists, code, task lists, tables and links. Showing a description never changes
  it; a description you edit is saved as the editor writes Markdown, which may differ from how it
  was written (`*` lists become `-` lists, for instance). HTML in a description makes no elements
  except formatting such as bold, and runs nothing. Links to `http` and `https` addresses open in
  your default browser when clicked; other links open nothing. Tick a task list's box to change it.
  In the description, ⌘B makes text bold rather than hiding the sidebar. Click a status or priority
  to change it, and the project (**Add to project** for none) to move the issue to another project
  or out of one, picking it in a list you can search; it is saved at once. Click **Issues** in the
  title row to go back to the list. The arrows at the top right show the next and previous issue of
  the list as it is shown, and the count beside them says where the issue is in it; when the list
  does not show the issue, they go through every issue in the order of **All issues** with nothing
  checked. The `⋯` menu starts a new session for the issue (see Starting again below), copies the issue's identifier or title, gives it a parent or sub-issues or
  takes it from its parent (see Sub-issues below), marks it as blocked by an issue or blocking one
  (see Dependencies below), or deletes the issue for good, after asking; the list is shown then.
  Deleting an issue with sub-issues says how many there are: they stay, as top-level issues, with
  their own sub-issues. Deleting an issue that issues wait on says how many: they are no longer
  blocked by it, and its dependencies go with it.
- **Sub-issues**: as in Linear and GitHub, an issue can have a parent, whose sub-issue it is,
  and sub-issues of its own, any level deep: up to 8 levels below a top-level issue, an issue
  without a parent, and up to 100 sub-issues each. A parent and its sub-issues may belong to
  different projects, or to none, and keep their parent when they move; a status changes only its
  own issue. Under the description, an issue's page lists its sub-issues, in the order they became
  its sub-issues, each with its status and title, and its project when that is not the issue's
  (**No project** for none); their header says how many of those not canceled are done, such as
  **1/3**, beside a circle that fills as they get done (one in progress counts a quarter). Click
  **Sub-issues** to collapse or expand them, and a sub-issue to show its page. **Add sub-issues**
  (without any), the header's `+`, or ⌘⇧O opens a card there for a new sub-issue, with a title, a
  description, a status (Backlog), and the issue's priority and project, which you can change;
  **Create** (⌘ Enter) creates it as the last sub-issue, ⌘⇧ Enter creates it and keeps the card
  for the next one, and **Cancel** or Esc closes the card. The new issue dialog's draft is not
  touched. Under the title of a sub-issue, **Sub-issue of** names its parent, with the parent's
  progress; click it to show the parent. **Sub-issue of…** (⌘⇧P on the page) in the `⋯` menu and
  the row's menu picks the issue's parent, and **Parent of…** issues to become its sub-issues,
  taking them from any other parent, in a list you can search by identifier or title, which leaves
  out what would put an issue below itself and marks the parent an issue has; **Remove parent**
  makes it a top-level issue. A change that would break a limit changes nothing, and says why.
  The issues of a project removed from the list are not shown, nor counted, as anyone's parent or
  sub-issue, but keep their place, and are back in it when the project is added again.
- **Dependencies**: as in Linear and GitHub, an issue can be blocked by other issues, which it waits
  for, and block others. Under its properties, an issue's page lists under **Blocked by** the
  issues it is blocked by, and under **Blocking** those it blocks, done and canceled ones too, each
  with its status and title, and its project when that is not the issue's (**No project** for
  none); click one to show its page, or the `✕` at its end, which shows while you point at it, to
  remove the dependency. An issue waits on an issue it is blocked by while neither is done nor
  canceled: its status then has a small red badge, and its row on the list counts those it waits
  on and those that wait on it. **Blocked by…** and **Blocking…** in the `⋯` menu and the row's
  menu pick, in a list you can search by identifier or title, an issue that the issue becomes
  blocked by, or one that becomes blocked by it, at once; the list leaves out what the rules below
  do not allow. Its last item, whatever you type, **Create new issue blocking ISS-12…** (or
  **blocked by**), opens a dialog for a new issue with that dependency, titled with what you typed,
  in the backlog, without a priority, in the issue's project, all of which you can change;
  **Create** (⌘ Enter) creates it, and Esc closes it without creating anything. The new issue
  dialog's draft is not touched. Dependencies may join issues of different projects, or of none,
  and stay when the issues move. An issue waits for the issues it is blocked by, so no issue can
  wait for itself, through others or not; parents and sub-issues count for nothing here: an issue
  can be blocked by an issue above or below it, or block one, both ways, and a parent is given
  whatever the dependencies. An issue is blocked by at most 50 issues and blocks at most 50. A
  change that would break a rule changes nothing, and says why. The dependencies of the issues of a
  project removed from the list are not shown nor counted, but still count for the rules, and are
  back when it is added again. Work cannot be started on an issue while it waits on an issue (see
  Starting again below).
- **Labels**: as in Linear, labels belong to no project: any issue, also one without a project,
  can have any label, and keeps its labels when it moves. A label has a name, which no other label
  has whatever its case, a color and a description, and may be in a group, of which an issue has
  at most one label: given another label of the group, it no longer has the one it had. A label
  in a group is written after its group's name, such as `Spec-driven › triaging`. Under its
  properties, an issue's page lists under **Labels** the labels it has, each with its color and a
  `✕` that takes it off, and **Add label**, which opens a list of every label you can search, each
  with its description, those the issue has checked: check one to give it, uncheck it to take it
  off. When what you type is no label's name, the list's last item, **Create new label**, creates a
  label of that name, with a color Hoot picks, and gives it to the issue. Labels are managed on the
  settings' [Labels](#settings) page, and with [`hoot`](#the-hoot-command).
- **Keys**: on an Issues page, unless you are typing in a field or the description, or a menu or
  dialog is open: C opens the new issue dialog; J and K (and on a list ↓ and ↑) move to the next
  and previous issue; Enter shows the issue moved to on a list, and Tab moves from its row to its
  start button; S and P change the status and the priority, in a picker where you can search or
  press the value's digit; ⌘⌫ deletes, after asking; and Esc on an issue's page goes back to the
  list. On an issue's page, also while you type in its fields, ⌘⇧O adds a sub-issue and ⌘⇧P picks
  its parent.
- **The workflow**: work on an issue goes through Hoot's built-in workflow, **Spec-driven**, in
  Claude Code sessions started from the issue. For now it has two steps, **Triage** and **Design**.
  How far an issue has come is the label of the group **Spec-driven** it has, and nothing else: none
  before it starts, **triaging** while it is at Triage, **ready to design** while it waits for you
  to start Design, **designing** while it is at Design, and **waiting on sub-issues** once it is
  finished. Changing the label, in the window or with `hoot`, moves the issue on or back; taking it
  off makes the issue not started again. In **Triage**, the agent judges the issue against the
  project: whether it is one piece of work, or several, results that could each be delivered and
  accepted on their own. If it is one, the agent says why, changes the issue's label to
  **ready to design** with [`hoot issue edit`](#the-hoot-command) without asking you, and stops. If
  several, it splits the issue into one issue per result, each with a title, a description and the
  issues it waits on, ends with their order, and asks you to confirm the split; when you object or
  ask for changes, it revises and asks you again. Once you confirmed the split, the agent writes it
  back: it creates all of its issues at once with [`hoot issue create-batch`](#the-hoot-command), as
  sub-issues to do of the issue, each with **ready to design**, waiting on the issues of the split
  and others as you confirmed their order, and blocking the issue; then it gives the issue
  **waiting on sub-issues**, and stops, starting no session for the sub-issues. An issue with
  **waiting on sub-issues** is completed once its sub-issues are: when the last of the sub-issues
  Hoot shows (it has at least one) becomes done or canceled, or goes, the issue, unless it is done
  or canceled already, becomes Done when one of them is done, and Canceled otherwise; this happens
  only as that comes to be, so an issue you open again stays open, and so does one given a sub-issue
  to do. In **Design**, the agent interviews you until every decision about the issue is settled: in
  rounds, with its tool for asking structured questions if it has one, or with numbered options in
  its reply, each round asking every open decision whose prerequisites (the decisions and facts its
  options depend on) are settled, those that unblock the most first, each with the option it
  recommends first, its main reason and its cost. It asks you only for decisions and for facts only
  you can provide, finds out every other fact itself, even one you stated, and puts to you as a
  decision what it finds that contradicts you. Once nothing is left open, it sums up the outcome and
  its boundaries, the requirements and decisions as you settled them, and the facts it relied on,
  each with how it established it, and the risks you accepted, and stops. Nothing comes after Design
  for now: the issue stays at **designing**, and starting work on it again starts Design over in a
  new session. The workflow is data, which Hoot runs as it would run any workflow; its prompts name
  no agent. A label that the group had and the workflow no longer has, such as one of a step taken
  out, leaves the group, and stays on its issues like any other label. Labels change no status, and
  changing the status, the project or anything else of the issue changes nothing of its progress.
- **Starting work**: the start button of an issue that is neither done nor canceled, at the end of
  its row in the list and above the properties on its page, hands the issue to Claude Code in a
  worktree of its own, at the first step of its workflow when it has not started, at the step it is
  ready for when it has a step's ready label, such as Design for **ready to design**, and at the
  step of its label otherwise. It shows a paper plane, which turns into Claude Code's mark while you
  point at it or move the keyboard focus to it, and its tooltip says what it does, such as
  **Start Triage with Claude Code in a new worktree**,
  **Start Design with Claude Code in this issue's worktree** or
  **Continue Triage with Claude Code in this issue's worktree**.
  Clicking it saves what you typed in the issue, then starts Claude Code, at the permission level
  picked in the Agents menu at the click, in the issue's worktree, and shows the session as soon as
  it appears, whatever page is shown then, with the keyboard focus in its terminal; going back shows
  the page shown before it. The issue's worktree is a worktree of the issue's project whose branch
  is `iss-12`, or starts with `iss-12-` (for `ISS-12`), and whose folder exists; of several, the
  first in the sidebar. When there is none, Hoot first creates one, without asking: a new branch
  named after the issue, such as `iss-12-fix-the-login-bug-on-safari` (the title's letters and
  digits, of any script, in lower case, and a `-` for each run of anything else, cut to 60
  characters), or `-2`, `-3` and on after the name when a repository taking part already has a
  branch of that name; from the branch checked out in the project's main worktree, with the nested
  repositories that **New Worktree…** includes by default, at
  `~/.hoot/worktrees/<project>/<branch>`. The project expands to show the worktree's row. Meanwhile
  the button spins and clicking it does nothing; the rest of Hoot can be used as usual. The branch
  keeps its name when the title changes. The session is named after the issue's title. Once the
  session has started, an issue that had not started gets the first step's label,
  **Spec-driven › triaging**, and one ready for a step gets the step's label in place of the ready
  label, such as **designing** for **ready to design**, which its activity records as yours; one
  whose label changed meanwhile keeps it. Hoot writes the issue, its title as a heading and
  its description below it, to `issue.md` in a new folder of the session's own in `.hoot/tmp` of
  the worktree, where Claude Code reads its files without asking at any permission level; NUL
  characters are left out. A `.gitignore` there has Git ignore everything in `.hoot/tmp`, itself
  included, which leaves the rest of `.hoot` to files a project might commit. When the session can
  go on from the step it starts at to another, Hoot also writes beside it the whole workflow to
  `workflow.md`: its name, each step in order with its label, and its ready label if it has one, its
  prompt and its outcomes (the label each changes to, what it means and what to do first, and
  whether the agent goes on or stops afterwards), or that it stops once it is done, and the end
  labels, with what **waiting on sub-issues** does; a session of Triage or Design, which stop either
  way, gets `issue.md` alone. The first message says where `issue.md` is, and `workflow.md` when
  there is one, and names the worktree's branch; then it gives the step's prompt and its outcomes,
  each with what it means, the command that changes the label, such as
  `hoot issue edit ISS-12 --add-label 'ready to design'`, and whether to go on with that label's
  step from `workflow.md` afterwards, or stop; for a step without outcomes, such as Design, it says
  to stop once the step is done. The message would do for any agent, and the issue
  stays out of it, where an agent could take some of its text for a command or a mention. Like any
  other session, this one can change files as far as its permission level lets it. Once the session
  has started, an issue in the Backlog or Todo is In Progress. Hoot removes the session's folder
  once the session's process has ended, or when it could not start, and leaves `.hoot/tmp` with its
  `.gitignore`; if Hoot stops without quitting, the session's folder stays there too, out of Git's
  sight, until the worktree is deleted. Hoot types nothing into the session and answers none of
  Claude Code's questions, such as whether you trust the folder, which Claude Code asks once for a
  project and all its worktrees. It writes no file of its own to `~/.claude`, `~/.claude.json` or
  the project, and none to the worktree outside `.hoot/tmp`: apart from what Git writes,
  `git status` stays clean there.
- **Starting again**: an issue can have several sessions opened from it at once. While one is in
  the sidebar, the start button says so and shows the one opened last, whatever project the issue
  is in since and whatever else holds. **Start new session**, in the `⋯` menu and the row's menu,
  opens another, in the issue's worktree, at the step of its label, with new files of the issue as
  it is then, however many it has. Work cannot be started, and **Start new session** cannot be
  picked, while Hoot is still checking whether Claude Code is installed after it starts, when it is
  not installed, for an issue without a project, in which its worktree would be, while the issue
  waits on issues neither done nor canceled (see Dependencies above), or once its workflow is
  finished; the button's tooltip then says why, listing the issues it waits on with their titles.
  Checking again with **Re-detect Tools** keeps the last check's answer until it is done. To work
  on an issue whose workflow is finished, take off or change its label, or start a session in its
  worktree with the worktree row's `+`.
- **Activity**: below the sub-issues, an issue's page lists, in the order they happened, when the
  issue was created; each label it was given or had taken off, as the label was written then,
  with its color, by you or by an agent, such as **Added label Spec-driven › triaging · by agent ·
  2 hours ago** (a label of a group given in place of another takes the other off, which is listed
  too); and when the issue was done or canceled.
- **When it cannot start**: when the issue's project is not a Git repository, Hoot creates nothing
  and says that it cannot have worktrees. When the project's main worktree has no branch checked out
  (its HEAD is detached), or a nested repository has neither a branch named like the project's nor
  one checked out, Hoot creates nothing and says so, suggesting **New Worktree…**, where you pick
  the base branches yourself. When Git cannot create the worktree, Hoot removes what it created and
  shows Git's output; when Git creates it but a hook such as `post-checkout` fails, the worktree is
  kept, Hoot shows Git's output as a warning, and the session starts. When Claude Code cannot start,
  such as when it is no longer installed, Hoot says
  **Could not start Claude Code.** and why, keeps the worktree, and leaves the issue's status as it
  was.
- **Drafts**: the new issue dialog has one draft, wherever you open it: what you enter stays when
  the dialog closes (with Esc, its close button, or by showing another page), until you create the
  issue or quit Hoot. Removing the draft's project from the list leaves the draft without a
  project, keeping the rest. Quitting does not ask about drafts.
- **Removing a project** from the list keeps its issues. Until you add the project again, they are
  neither on the list nor in the counts, and their pages close and leave the pages to go back to;
  then they come back, done and canceled ones included, with their numbers and as they were.

## The hoot command

In every session Hoot starts, `hoot`, Hoot's command line program, reads and creates the issues of
the session's project and changes their labels, with commands modeled on `gh issue`, manages the
labels, modeled on `gh label`, and starts sessions for the issues. It knows nothing of any
workflow: the [workflow](#issues) uses these commands as it says. It works with the Hoot that started the
session and the project the session belongs to (also when it runs in one of the project's
worktrees), whatever the current folder, and whichever other Hoots run at the same time, such as an
installed one and one run from its repository.

```sh
hoot issue view ISS-12         # or by its number: hoot issue view 12
hoot issue list                # the issues neither done nor canceled
hoot issue list --status todo --status in-progress
hoot issue create --title "Fix the login bug" --description-file notes.md --priority high
hoot issue create --title "Write the tests" --parent ISS-12   # a sub-issue of ISS-12
hoot issue create --title "Ship it" --blocked-by ISS-14,ISS-15
hoot issue edit ISS-12 --add-sub-issue ISS-14,ISS-15
hoot issue edit ISS-15 --add-blocked-by ISS-14 --remove-blocking ISS-16
hoot issue edit ISS-12 --add-label 'ready to design' --remove-label bug
hoot issue list --label ui --label bug     # the issues with both labels
hoot issue create-batch ISS-12 --file plan.json   # sub-issues of ISS-12, all at once
hoot label create bug --color eb5757 --description "Something is broken"
hoot session start ISS-14                  # a session for ISS-14, as its start button opens
```

- **`hoot issue view <issue>`** shows an issue, given its identifier (such as `ISS-12`) or its
  number (`12`): its identifier and title; then its status, its priority and when it was created
  (in local time, to the minute); then, if it has labels, a line such as
  `Labels: bug, Spec-driven › triaging`; then, if it has a parent, a line such as
  `Sub-issue of ISS-4 Ship it (Todo)`; then, if it has a description, a blank line and the
  description as it is written, in Markdown; then, if it has sub-issues, a blank line,
  `Sub-issues · 1/3 (33%)` (how many of those not canceled are done) and a line for each, with
  its status, identifier and title; then, if it is blocked by issues, a blank line, `Blocked by`
  and a line for each, the same way, and if it blocks issues, a blank line, `Blocking` and a line
  for each. A related issue of another project than the session's is followed by its project's
  name, or **No project**, in parentheses.
- **`hoot issue list`** lists the project's issues that are neither done nor canceled, one per
  line with its identifier, status, priority and title, followed by its labels, if any, in
  brackets, in the order of **All issues** with only the project checked. `--all` lists every
  issue, and `--status <name>`, given once for each status, only the issues with those statuses,
  done or not. `--label <names>`, given again or with names separated by commas, lists only the
  issues that have every one of those labels, as `gh issue list --label` does.
- **`hoot issue create --title <title>`** creates an issue in the project, and prints its
  identifier. Its description is `--description <text>`, or what the UTF-8 file
  `--description-file <file>` holds (`-` reads standard input), exactly as given, or none; its
  status is `--status <name>`, `backlog` unless given; its priority `--priority <name>`, `none`
  unless given. Otherwise it is created as the new issue dialog creates one: its title on one
  line, each line break a space, and without the whitespace around it; with the next number; and
  completed as it is created when it is done or canceled. With `--parent <issue>`, an issue of the
  project, it is created as that issue's last sub-issue, with its priority unless `--priority` is
  given. `--blocked-by <issues>` makes it blocked by issues of the project, separated by commas,
  and `--blocking <issues>` makes issues of the project blocked by it; it is created with them, or
  not at all when they would break the rules of [dependencies](#issues). `--label <names>`, given
  again or with names separated by commas, gives it those labels.
- **`hoot issue edit <issue>`** changes an issue's parent, sub-issues, dependencies and labels,
  all together or, when one change cannot be made, not at all, and prints its identifier:
  `--parent <issue>` makes it a sub-issue of another issue of the project, `--remove-parent` a
  top-level issue, `--add-sub-issue <issues>` makes issues of the project, separated by commas, its
  last sub-issues in that order, and `--remove-sub-issue <issues>` makes sub-issues of it top-level
  issues; `--add-blocked-by <issues>` and `--remove-blocked-by <issues>` make it blocked, or no
  longer blocked, by issues of the project, and `--add-blocking <issues>` and
  `--remove-blocking <issues>` make issues of the project blocked, or no longer blocked, by it;
  `--add-label <names>` gives it labels, in order, and `--remove-label <names>` takes labels off it,
  each given again or with names separated by commas; a label of a group takes off the issue the
  other label of that group it has. It refuses what would put an issue below itself, more than 100 sub-issues under an issue or an issue
  more than 8 levels below a top-level one, removing a parent the issue does not have or a
  sub-issue it does not have, making a dependency there already or removing one that is not, the
  same issue or label both added and removed, what would break the rules of
  [dependencies](#issues), and an edit without any of these options.
- **`hoot issue create-batch <issue> --file <file>`** creates, from a JSON array in the UTF-8 file
  (`-` reads standard input), an issue for each object as the issue's last sub-issues, in order,
  all together or, when one cannot be created, none, and prints their identifiers, one per line.
  Each object has `title`, and may have `description`, `status` and `priority` (by their names),
  each created as `hoot issue create --parent <issue>` creates it, `labels`, the names of its
  labels, and `blockedBy` and `blocking`, the issues it is blocked by and those it blocks: each the
  place of another object in the array, from 1, or the identifier of an issue of the project, such
  as `"ISS-12"`. A sub-issue may block its parent, as a split written back does.

  ```json
  [
    { "title": "Parse the input", "status": "todo", "blocking": ["ISS-12"] },
    { "title": "Report errors", "labels": ["bug"], "blockedBy": [1, "ISS-9"] }
  ]
  ```

- **`hoot label list`** lists every label, one per line with its name, its group (**No group** for
  none), its color and its description, in the order of the settings' Labels page.
  **`hoot label create <name>`** creates a label without a group, with the color `--color <color>`
  gives (six hexadecimal digits, such as `ff8800`) or one Hoot picks, and the description
  `--description <text>` gives, or none. **`hoot label edit <name>`** changes a label's name, color
  and description with `--name`, `--color` and `--description`. **`hoot label delete <name> --yes`**
  deletes a label, taking it off every issue, as the Labels page does; without `--yes` it deletes
  nothing. They refuse a name that is no label's, a name another label has, a color that is not six
  hexadecimal digits, and changing or deleting a label of the workflow's group. Labels are found
  by their names, whatever their case; a label in a group by its name alone.
- **`hoot session start <issue>`** starts a Claude Code session for an issue of the project, as its
  start button opens one: in the issue's worktree, created first when it has none, at the
  permission level picked in the Agents menu, giving an issue not started the first step's label,
  and one ready for a step the step's label (recorded as the agent's), and moving one in the Backlog
  or Todo to In Progress. The session shows in the sidebar, and the window goes on showing what it
  showed. With
  `--prompt-file <file>`, the session's first message is all that the file holds, instead of the
  one its start button would give; the issue's files are written all the same. `hoot` prints the
  root of the worktree once the session has started. It refuses, opening nothing, what the start
  button could not start, saying every reason, such as the issues the issue waits on; and an issue
  that is not one of the project. Sessions it opens can start sessions too, and there is no limit to
  how many.
- **Names**: the statuses are `backlog`, `todo`, `in-progress`, `done` and `canceled`; the
  priorities `none`, `urgent`, `high`, `medium` and `low`.
- **`--json`** prints the issue, or the list (and the issues `create-batch` creates) as an array,
  as JSON objects with exactly `identifier`, `number`, `title`, `description`, `status`,
  `priority`, `createdAt`, `completedAt`, `parent`, `subIssues`, `subIssuesSummary`, `blockedBy`,
  `blocking` and `labels`, the times in UTC in ISO 8601, `completedAt` being `null` while the issue is neither
  done nor canceled. `parent` (`null` for a top-level issue) and each of `subIssues`, `blockedBy`
  (the issues it is blocked by) and `blocking` (those it blocks) have `identifier`, `number`,
  `title`, `status` and `project` (its name, or `null` for none); `subIssuesSummary` has `total`
  (the sub-issues not canceled), `completed` (those done) and `percentCompleted`, rounded down. A
  related issue of a project removed from Hoot's list is left out, as the window leaves it out.
  `labels` lists the issue's labels, each with `name`, `color`, `description` (empty for none) and
  `group` (its group's name, or `null` for none), and is empty without any; `hoot label list --json`
  prints labels the same way. `hoot --help`, `hoot issue --help`, `hoot label --help` and
  `hoot session --help` explain all of this.
- **In the window**, an issue `hoot` creates shows at once: in the counts of its project's row and
  of the **Issues** row, on the list when what is checked and the view show it, among the
  issues an issue's page steps through, and among its parent's sub-issues. Parents, sub-issues,
  dependencies and labels `hoot` changes show at once too, and so do the issues Hoot completes. Nothing else changes there: no message pops up, the page, the
  sidebar and the keyboard focus stay as they are, and so does what you are typing. Hoot does not
  record that `hoot`, or which session, created an issue.
- **When it cannot** do what it is asked, `hoot` says why on standard error and exits with code 1,
  without creating, changing or recording anything: when an issue is not in the project, a name,
  option, command or file is wrong, a parent, sub-issue or dependency would break the rules of
  sub-issues or dependencies, a label is not one or cannot be changed, a session cannot be started,
  the Hoot that started the session is not running any more, or it does not run in a session Hoot
  started.
- **Agents** are told about `hoot` only by the first message of a session started from an issue,
  and the `workflow.md` beside its issue when there is one, which ask them to change the issue's
  label with `hoot issue edit` when a step is done, and it is not allowed in advance: a
  coding tool runs it like any other command, at its [permission level](#permission-levels), and
  Hoot changes no tool's settings for it. At Codex's **Default** and **Read Only** levels, Codex's
  sandbox may block `hoot`'s connection to Hoot, and `hoot` then says so: let it run outside the
  sandbox, as Codex offers to with your approval, or pick **Full Access**.

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
comes before it. On Windows, Hoot listens on a named pipe, and cmd and PowerShell run `hoot.cmd`,
and Git Bash `hoot`, both in that folder.

## Worktrees

Worktrees let several agents work on one project at the same time, each on a branch of its own in
a folder of its own. Only a project that is a Git repository has them: for any other project, the
new worktree dialog says so.

- **Creating**: choose **New Worktree…** from a project's `+` menu or its context menu, enter the
  name of a new branch and pick the local branch it starts from. Hoot creates the branch and checks
  it out in a linked worktree in `~/.hoot/worktrees/<project>/<branch>` (with `/` and other
  characters that do not belong in a folder name replaced by `-`). An installed Hoot and one run
  from its repository use the same folders. Hoot does not start a session in the new worktree; it
  expands the project, if it was collapsed, to show the worktree's row. An issue's
  [start button](#issues) creates a worktree for the issue the same way, without the dialog, and
  starts Claude Code in it.
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
- **Windows**: Hoot for Windows is a preview. It adds projects, with Git on `PATH` (where Git for
  Windows puts it by default), starts sessions, and has the [Agents](#agents) page, which installs
  and updates agents with the npm of your Node.js (install Node.js first; the page says so when it
  is missing). Run the installer
  (`Hoot-Setup-<version>.exe`): it installs Hoot for you alone, in `%LOCALAPPDATA%\Programs\Hoot`,
  without asking anything. The installer is not signed, so Microsoft Defender SmartScreen may say
  "Windows protected your PC": click **More info**, then **Run anyway**. It cannot be installed on a
  PC with Smart App Control turned on.

### Updating

Hoot looks for a newer version when it starts and every hour after, among the releases published
on GitHub. When there is one, a blue button with a download icon appears at the right of
**Settings**, at the bottom of the sidebar, and says **Update** under the pointer. Clicking it
downloads the new version, the button showing how much of it has arrived, then restarts Hoot with
it. Restarting ends the sessions, and they are not restored: while some are running, or an agent
is being installed or updated, Hoot asks first, and **Cancel** keeps them, with the button there
for later.

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

This Hoot does not look for newer versions. To update it, run `pnpm app:install` again, then quit
Hoot and open it again. Until then, a running Hoot keeps the version it started with. Quitting
ends its sessions, and they are not restored.

## Releasing

Every change that users of Hoot would notice comes with a changeset: a Markdown file in
`.changeset/` that says how it changes the version (`patch`, `minor` or `major`) and, in one
sentence, what changed for users. Write it with

```sh
pnpm changeset
```

which asks for the kind of change and its summary, or add the file yourself, and commit it in the
same commit as the change. Its summary becomes the change's entry in `CHANGELOG.md` and in the
release's text, linked to the commit that added the changeset. Hoot is in Changesets'
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
   release. Once it is published, the Hoot of an earlier release offers the version (see
   [Updating](#updating)); a draft is offered to no one.

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

The release workflow runs `pnpm check` on macOS and on Windows, where the tests of what Hoot does
only on the other platform are skipped. On Windows the tests need Git for Windows, and they make
symbolic links, which Windows lets you make in Developer Mode (**Settings** > **System** > **For
developers**) or as an administrator.

To check a change in the running app, drive the built app with Playwright's Electron support
(`_electron.launch`). Give it a temporary `--user-data-dir` so that it keeps its own projects,
issues and settings, and `--background` so that its window stays off screen. With `--test-hooks`
the page also exposes the sessions' terminals as `window.hootTestHooks`.

With `--windows-layout` (for example `pnpm start --windows-layout`), Hoot leaves an empty area as
wide as the window's buttons on Windows, 140 pixels, at the right end of the window's top row, as
it does on Windows: it shows on a Mac whether anything in the row would be covered there.

## Architecture

| Part     | Location       | Role                                                                                                                                                       |
| -------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Main     | `src/main`     | Window, menu, database, projects, issues, permission levels, tool detection, installing and updating agents, session processes, quitting, answering `hoot` |
| Pty host | `src/pty-host` | Electron utility process; the only place node-pty is loaded                                                                                                |
| Preload  | `src/preload`  | The `window.hoot` bridge between the renderer and the main process                                                                                         |
| Renderer | `src/renderer` | React 19, zustand, Tailwind CSS 4 and shadcn/ui (Base UI), xterm.js                                                                                        |
| Shared   | `src/shared`   | Types and messages used by more than one process                                                                                                           |
| hoot     | `src/cli`      | The [`hoot` command](#the-hoot-command), which Hoot's executable runs as Node.js; its launchers are in `resources/bin`                                     |

Everything is built by Vite 8 with `vite-plugin-electron`, which bundles every package except
node-pty, the only runtime dependency. Hoot keeps its data in the app's user data folder: `~/Library/Application Support/Hoot` for the installed app, and
`~/Library/Application Support/Hoot-dev` for runs from the repository.

- The projects, their issues, the issues' parents and dependencies, the labels and the activity of
  the issues' labels are in a SQLite database, `data/hoot.db`, which Hoot reads and writes with Node's built-in
  `node:sqlite`, in plain SQL. Its tables' version is its `PRAGMA user_version`, the number of the migrations in
  `src/main/database` it has had: 1 for the tables of the first release. On opening it, Hoot applies
  the migrations after that version, all in one transaction. The tables change only by a new
  migration at the end, which keeps what is in them; a migration that has been released is never
  changed.
- If the database cannot be used when Hoot starts (it is not a database, cannot be read, written
  or created, was written by a newer Hoot, or cannot be upgraded), the window shows only why and
  where the file is, with **Show in Finder** (**Show in File Explorer** on Windows) and **Quit**,
  and Hoot leaves the file as it is.
- The permission levels picked in the Agents menu, whether the sidebar is hidden and how wide it is,
  which projects in it are collapsed, and the appearance picked in the settings are in
  `settings.json`.

Worktrees are read from Git: a project's worktrees are the linked worktrees in its folder in
`~/.hoot/worktrees`, whose `.hoot-project.json` records the project it belongs to.

Icons come from [lucide](https://lucide.dev), except the marks of the tools Hoot starts, which Hoot
keeps as SVG files in `src/renderer/assets/brand-icons`: Claude Code's, in its orange, is copied
from Anthropic's Claude Code extension for VS Code; Codex's blossom is copied from OpenAI's Codex
extension for VS Code, with its black replaced by the color of the text around it; opencode's, in
the two sets of grays it comes in, one for each theme, are from opencode's brand assets.

## License

Hoot is released under the MIT License. The icons of Claude Code, Codex and opencode
(`src/renderer/assets/brand-icons`) are trademarks of Anthropic, OpenAI and opencode's authors, and
are not covered by Hoot's MIT License.
