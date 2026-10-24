# hoot

## 0.1.0-alpha.16

### Patch Changes

- [`a969373`](https://github.com/Levix0501/hoot/commit/a96937329d7eb25b6dd27e798c1b3c3ed9826c44) - Every row in the sidebar spans its full width, with a worktree's sessions inset below it instead of beside a line, and a click collapses or expands a worktree as it does a project, showing a closed or an open package and, while collapsed, the light of its session that needs you most.

- [`9d0ca2c`](https://github.com/Levix0501/hoot/commit/9d0ca2c9e1c72cc2021ef00e82c5f472c5291a60) - In the sidebar, session lights sit at the right end of their rows and a waiting session's light pulses; a project no longer counts its open issues, and its light gives way to its buttons while they show; and a worktree shows a package icon and its name on one line, without the branch, with its `⋯`, now the same menu as a right click, and a `+` that starts a session with the default agent showing only while it is pointed at.

- [`a969373`](https://github.com/Levix0501/hoot/commit/a96937329d7eb25b6dd27e798c1b3c3ed9826c44) - Pointing at the sidebar's rows, lights and buttons no longer shows tooltips.

## 0.1.0-alpha.15

### Minor Changes

- [`aec4c65`](https://github.com/Levix0501/hoot/commit/aec4c653768b0ba9b1743fb56485a70ced60e8bc) - Adding a folder that is in no Git repository, or in one without a commit, asks before Hoot initializes it and commits its files.

- [`aec4c65`](https://github.com/Levix0501/hoot/commit/aec4c653768b0ba9b1743fb56485a70ced60e8bc) - The `+` on a project opens a New Worktree dialog that names the worktree, picks its agent and sets its base branches under Advanced, and the sessions you start in a worktree are kept to continue after the agent exits or Hoot restarts.

### Patch Changes

- [`9a48163`](https://github.com/Levix0501/hoot/commit/9a4816367e8382ce1609bedbdd60cfc4123a186c) - A working chat's spinner in the sidebar is the size of a session's light and turns in place, instead of growing to the size of a menu icon and wobbling as it turned.

- [`42c582c`](https://github.com/Levix0501/hoot/commit/42c582cdef2b40f43ad7927137365e66cba796f0) - A collapsed project in the sidebar shows a closed folder, and **New chat** shows a pencil with sparkles.

- [`f9eafc2`](https://github.com/Levix0501/hoot/commit/f9eafc25fbb623121ad5fb44b9a180468bc7a18f) - The sidebar's rows are 30px tall with 10px rounded corners, regular-weight labels and icons in the row's text color; Issues and New chat sit 1px apart, a project's hover buttons no longer include Issues and put **New Session** at the right with **More Actions** beside it, and an empty Chats group says **No chats**.

## 0.1.0-alpha.14

### Minor Changes

- [`7159434`](https://github.com/Levix0501/hoot/commit/715943492af58ffbd7ef8f812de4646c41a58bd2) - The Agents page has a Default agent picker above YOLO mode, and marks the agent it picks Default in the list.

- [`bc16d08`](https://github.com/Levix0501/hoot/commit/bc16d08ff5c1999b50eb701689124e820da3e2e5) - New chats in the sidebar start an agent without adding a project, keep the conversation across restarts, and continue it where it left off.

### Patch Changes

- [`195280c`](https://github.com/Levix0501/hoot/commit/195280c523a4ba84513652bd0021290ba9e84ba8) - Installs and updates on the Agents page no longer offer Cancel once they have started, since it only took effect after the download had finished; one still waiting its turn can be cancelled as before.

- [`da0db96`](https://github.com/Levix0501/hoot/commit/da0db9610cad7bd0093e4ca2b30d13f98f2291e2) - After Hoot starts, the settings now open on Agents, the first page in their list, instead of Appearance.

## 0.1.0-alpha.13

### Patch Changes

- [`c8c6a07`](https://github.com/Levix0501/hoot/commit/c8c6a07a6a5bf95fbd440cdeb55e0ac4721697ff) - On Windows, the Agents page no longer flashes console windows while it checks the agents, as it did twice for a Codex installed with npm.

## 0.1.0-alpha.12

### Patch Changes

- [`0556f68`](https://github.com/Levix0501/hoot/commit/0556f6808b0de405a698c8368b251bf7ff6d33e9) - Agents now comes first in the list of the settings' pages, above Appearance.

## 0.1.0-alpha.11

### Minor Changes

- [`ec7eccd`](https://github.com/Levix0501/hoot/commit/ec7eccd811e0ad5f0968190a9293730521849a34) - The Agents page now shows each agent's new-session command and lets you edit it in place: a global YOLO mode switch, model and effort choices read from each agent's own configuration, extra arguments, and a per-agent enable switch. Detection runs when the page opens, and updates and installs report failures in a dialog with the command, exit code and output.

### Patch Changes

- [`18a1186`](https://github.com/Levix0501/hoot/commit/18a1186a06f5a145df1f7cdb6b324a7d7d9dc007) - Every spinner now looks the same and turns once a second, and on a Retina screen it keeps turning smoothly while Hoot is busy.

- [`ad1806c`](https://github.com/Levix0501/hoot/commit/ad1806c293354ba604da98c8b4426a0b386fbf68) - Pressing Esc to close a dropdown list in the settings no longer leaves the settings.

- [`08e8265`](https://github.com/Levix0501/hoot/commit/08e82654ef36a03af005c2b5969914923f86020c) - Settings pages are wider: their content now spans up to 768 pixels.

## 0.1.0-alpha.10

### Patch Changes

- [`1f8cabb`](https://github.com/Levix0501/hoot/commit/1f8cabb33614df4c2a6402f673b2aa2e7d26b7fb) - A session's row in the sidebar no longer shows a close button when you point at it; close a session with **Close** in its context menu, the button in the session header, or **File > Close Session**.

- [`033ee79`](https://github.com/Levix0501/hoot/commit/033ee79f69face1cac95593cf669298bf5dd1854) - Renaming a session, by double-clicking it or with **Rename…** in its context menu, now opens a dialog for the new name instead of a field in the sidebar.

- [`8b14c03`](https://github.com/Levix0501/hoot/commit/8b14c03ecf7a133700921e76b584a2aa4239cf37) - A session's header now shows only the session's name, without the project and worktree it runs in, which the sidebar already shows.

## 0.1.0-alpha.9

### Minor Changes

- [`60ec1e2`](https://github.com/Levix0501/hoot/commit/60ec1e2b1ec3e4690cbacc0e8584045a95a1d338) - The Agents page shows on Install and Update the command each runs, and says beforehand when it cannot work: when an agent that runs on Node.js needs a newer Node.js than yours, or when you cannot write to the npm folder of the installation to update.

- [`0bd98f9`](https://github.com/Levix0501/hoot/commit/0bd98f96350aa2a00dbeae1c61cd78e925a4948d) - Hoot no longer comes with npm or a `node` of its own: on macOS, as on Windows, Install uses your npm, and where there is none it can install with, the Agents page says whether Node.js and npm are missing or npm's global folder isn't writable; agents an earlier Hoot installed in `~/.hoot/agents` are no longer used.

- [`d487642`](https://github.com/Levix0501/hoot/commit/d487642924526e7fa13c658d919a115160a07755) - A light left of each session's tool icon now shows what the session is doing, and for Claude Code whether it is working, waiting for you, done while you were away, idle or stopped by an API error; the session header shows the same, and a collapsed project shows the sessions in it that need you.

### Patch Changes

- [`1b8889c`](https://github.com/Levix0501/hoot/commit/1b8889c555986416bcfa278a0239f6bdcc2def98) - On Windows, when an agent or npm takes too long to report its version or its global folder, Hoot also ends the programs it started, instead of waiting for them before the Agents page shows what it found.

- [`546349e`](https://github.com/Levix0501/hoot/commit/546349edbf5390c5c2717ebb30425a403172b737) - On Windows, creating a worktree, also to start work on an issue, no longer fails with "git exited with code 0" once Git has made it, and Hoot lists the inner repositories of a worktree and deletes them with it, along with the worktrees made inside it.

## 0.1.0-alpha.8

### Minor Changes

- [`4777f36`](https://github.com/Levix0501/hoot/commit/4777f36188b3fa9283d754f1179db13b0a0c2c7d) - Programs in a session can put text on the clipboard with OSC 52, the sequence Claude Code and other terminal programs copy with, also over SSH. They cannot read the clipboard.

### Patch Changes

- [`04bda73`](https://github.com/Levix0501/hoot/commit/04bda73899ddbb38e6d0ab568cc0c317d39beab0) - On Windows, the paths of nested repositories use `/`, as those of submodules do, and deleting a worktree removes a nested repository inside another one first, and no longer counts it as an uncommitted change of the outer one, or a populated submodule in a subfolder as a foreign repository.

- [`5c419e7`](https://github.com/Levix0501/hoot/commit/5c419e71ba360b55c7a0ff40129de8f5427455c3) - The new worktree dialog fits in the window however many nested repositories and submodules a project has: its fields scroll between its title and its Cancel and Create buttons, and a long list of submodules that stay empty scrolls on its own, instead of the dialog spilling past the top and bottom of the window.

- [`4d55273`](https://github.com/Levix0501/hoot/commit/4d55273b25f94bbdcfaf42034fad78b163dfb7e3) - The resize cursor stays for the whole of a drag of the sidebar's edge, also as the sidebar slides out and back in when the edge is dragged past its narrowest width.

- [`aa46d1f`](https://github.com/Levix0501/hoot/commit/aa46d1f353317aefbfdc586fdda92771346168a6) - On Windows, Ctrl+C copies the text selected in a session's terminal, and interrupts the program as before when nothing is selected, and Ctrl+V pastes instead of reaching the program as a control character. Ctrl+Shift+C and Ctrl+Insert copy too, as in Windows Terminal.

- [`50636b1`](https://github.com/Levix0501/hoot/commit/50636b136317091b8b0d2b1bb1580efe090a0bd3) - On Windows, a session's output no longer breaks up when the terminal changes width, as when the sidebar is shown or hidden: lines are no longer repeated, cut short or moved to the end of other lines.

## 0.1.0-alpha.7

### Minor Changes

- [`3d7a29e`](https://github.com/Levix0501/hoot/commit/3d7a29e6d0c15f21a8828e32541d9ae89f70eec7) - Starting work on an issue now takes it through a built-in workflow of Scope, Design and Implement, in which the agent reports each step with `hoot step report` and the issue's page shows the step it is at and what each step found, and lets you report a step yourself or start over.

- [`cfa8851`](https://github.com/Levix0501/hoot/commit/cfa88515ab2293e8347c5a0200e17abaa8052b72) - The built-in workflow now goes on to a Design step: the start button of an issue at `ready to design` starts it, the issue gets `designing` once its session has started, and the agent interviews you until every decision about the issue is settled, then sums up what was settled and stops.

- [`2dcf402`](https://github.com/Levix0501/hoot/commit/2dcf4023ea080be6de203c7a667c44eaf6d9f1de) - Issues can now be blocked by other issues, as in Linear and GitHub: an issue's page lists what it is blocked by and what it blocks, Blocked by… and Blocking… in its menus add a dependency or create an issue with one, the list shows how many issues each waits on and blocks, and hoot adds and removes dependencies with `issue create` and `issue edit`, shows them in `issue view` and `--json`, and splits an issue into sub-issues with dependencies with the new `issue split`.

- [`7cd733f`](https://github.com/Levix0501/hoot/commit/7cd733f94232231537567a533b70e74581421b2b) - Issues now have labels, as in Linear, given and filtered on the list and the issue's page, managed on a new Labels page in the settings and with `hoot label`, and the built-in workflow's progress is the issue's label of the group Spec-driven, which the agent changes with `hoot issue edit` instead of `hoot step report`, writing a confirmed split back as sub-issues with `hoot issue create-batch` (formerly `hoot issue split`) so that the issue is completed once they are; an issue can have several sessions, opened with Start new session or `hoot session start`, cannot be started while it waits on other issues, and can be blocked by its parent or sub-issues.

- [`a64972b`](https://github.com/Levix0501/hoot/commit/a64972bbeaacc461c7780ad248f82d1f2d09005b) - Issues can have sub-issues, as in Linear: an issue's page lists its sub-issues with their progress and creates new ones in place, a sub-issue's page names its parent, the menus set, change or remove an issue's parent, and `hoot issue create --parent`, the new `hoot issue edit` and `hoot issue view` do the same from a session.

- [`ecd101a`](https://github.com/Levix0501/hoot/commit/ecd101ae04b24439704dd9b929515c26d8bf8382) - The built-in workflow now has a single step, Triage (label `triaging`), which judges whether an issue is one piece of work or several and then stops: one piece gets `ready to design` without asking you, and a split you confirm becomes sub-issues labeled `ready to design`, with the issue labeled `waiting on sub-issues`; the Design and Implement steps are gone for now.

### Patch Changes

- [`8b7ae30`](https://github.com/Levix0501/hoot/commit/8b7ae3006c8ffc56123288be466f30818fbfb10f) - Hoot now writes the files of an issue it sends to a session to `.hoot/tmp` in the issue's worktree, a folder Git ignores, instead of the system's temporary folder.

- [`0680a85`](https://github.com/Levix0501/hoot/commit/0680a85e62f26a7ebe3b9986f09441b3ce76d34b) - The icons of Claude Code, Codex and opencode are now their own marks: Claude Code's in its orange, Codex's blossom and opencode's logo in the grays of the theme.

## 0.1.0-alpha.6

### Patch Changes

- [`efb4237`](https://github.com/Levix0501/hoot/commit/efb4237d697243ef1230fc3df2ae10549e69262f) - On Windows, the settings have the Agents page: Claude Code, Codex and OpenCode are installed and updated with the npm of the computer's Node.js, showing their versions and the latest ones, as on macOS.

- [`4c6bbea`](https://github.com/Levix0501/hoot/commit/4c6bbeaae65c6a3b2218772ec064cff29957d03a) - Confirmation dialogs keep what names what they ask about inside their frame: the close-session confirmation wraps a session's long name, such as the path a shell session is named after, and the delete-issue confirmation wraps a long issue title, instead of their text and buttons spilling out past the dialog's rounded edge.

- [`2505b7a`](https://github.com/Levix0501/hoot/commit/2505b7a104a1084fd3a9e1e2aa57e67287cedcb8) - OpenCode is installed and updated from its new npm package, `@opencode/cli`. On an OpenCode installed from the old `opencode-ai` package, the row says to update it the way you installed it.

## 0.1.0-alpha.5

### Patch Changes

- [`ed1b594`](https://github.com/Levix0501/hoot/commit/ed1b5948298d25e959e75cad8f5aadb01db840a4) - On Windows, closing a running session or quitting Hoot ends the session's processes at once, instead of waiting about 4 seconds and leaving them running.

- [`075818b`](https://github.com/Levix0501/hoot/commit/075818b2ccfa4d3e160eb54adda1a28479ddc9e2) - On Windows, closing a session also ends the programs started in it that keep running in the background, such as a dev server that Claude Code started, as quitting Claude Code with Ctrl+C does, instead of leaving them running.

## 0.1.0-alpha.4

### Minor Changes

- [`f0ab03e`](https://github.com/Levix0501/hoot/commit/f0ab03efbf83b70d91439bc81f93dc8f180ba5be) - A new About page in the settings shows Hoot's version and what it runs on, checks for a newer version whenever it is shown and downloads it on request, and About Hoot in the macOS menu opens it.

### Patch Changes

- [`f7d0d80`](https://github.com/Levix0501/hoot/commit/f7d0d806236b0af4a093b77b804de053a21dc1df) - The previews on the Appearance page no longer show a prompt with an agent's command in their terminal.

- [`5bc49fa`](https://github.com/Levix0501/hoot/commit/5bc49fa6044f462186eb6a92d565149de7aac4ce) - The rows of the settings' list of pages stand apart, so that the selected page's row and a hovered one next to it no longer run together.

## 0.1.0-alpha.3

### Patch Changes

- [`d6e61ec`](https://github.com/Levix0501/hoot/commit/d6e61ecf3e83bd7351100b93d5004ab5a55e7c55) - Starting Claude Code, Codex or OpenCode on Windows runs the installation found first on `Path`, one that npm or pnpm installed included, instead of exiting with code 2 or starting another one further down `Path`, such as an old `claude.exe`.

- [`5878dd0`](https://github.com/Levix0501/hoot/commit/5878dd025f578ddd0fb7437ded2becb4c7d50177) - On Windows, Hoot runs tools and Git in the environment it started with, which Windows gives every app: the new session menu no longer says that it could not read the login shell environment, and a Hoot started from Git Bash finds agents too.

- [`19df66e`](https://github.com/Levix0501/hoot/commit/19df66e18fb51189dc084b28dd5abbf299f1b790) - On Windows, a Shell session starts PowerShell: PowerShell 7 when it is on `Path`, or else the Windows PowerShell that comes with Windows, instead of failing to find `/bin/sh`.

## 0.1.0-alpha.2

### Minor Changes

- [`8001237`](https://github.com/Levix0501/hoot/commit/80012370479092e0b61d1ab0fb09f52aa8d3e5c0) - Any folder can be added as a project, not only one in a Git repository.

- [`aa91422`](https://github.com/Levix0501/hoot/commit/aa91422a9d672a30f5c2f04b0fc0b9eb3bf36cee) - On macOS, a new Agents page in the settings shows whether Claude Code, Codex and OpenCode are installed and up to date, and installs or updates them in a click, with your npm or with the one Hoot comes with.

- [`dccac0c`](https://github.com/Levix0501/hoot/commit/dccac0c8e21ca832a2d0c76d7c4f8b7ad9194b00) - The sidebar can be resized by dragging its right edge, from 240 to 520 pixels wide, and hidden by dragging the edge narrower than 120; double-clicking the edge gives it back its default width of 275.

- [`21b8261`](https://github.com/Levix0501/hoot/commit/21b8261eb912e3b7a2be4ee3a6e4303f3debac38) - Each open issue has a start button, at the end of its row and in place of Send to Claude Code on its page, that starts Claude Code on the issue in a worktree of its own, created for it when it has none.

### Patch Changes

- [`3880f12`](https://github.com/Levix0501/hoot/commit/3880f125791a1bfa2f137775c08f27272a80b2fd) - Adding a project on Windows works: Hoot finds Git on `PATH` instead of failing with `spawn /usr/bin/git ENOENT`.

## 0.1.0-alpha.1

### Minor Changes

- [`62e24b9`](https://github.com/Levix0501/hoot/commit/62e24b959aaf76633a72ff8be3850be1a799a88f) - When a newer version of Hoot is out, an Update button beside Settings downloads it and restarts Hoot with it.

## 0.1.0-alpha.0

### Minor Changes

- [`7bc8dc5`](https://github.com/Levix0501/hoot/commit/7bc8dc571524a3eaf9db06a9410c7d9f9b5761f2) - The first alpha of Hoot, a desktop app for running coding agents such as Claude Code, Codex and OpenCode on your Git projects, with worktrees and issues.
