# hoot

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
