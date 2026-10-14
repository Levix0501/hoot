# hoot

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
