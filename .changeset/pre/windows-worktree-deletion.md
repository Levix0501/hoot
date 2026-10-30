---
'hoot': patch
---

On Windows, Hoot's Git commands take paths longer than 260 characters, so deleting a worktree with a deep `node_modules` no longer fails partway, its files are deleted without following or leaving behind the links pnpm makes, and a deletion that stops partway, as when a file is in use, leaves a worktree that can be deleted again.
