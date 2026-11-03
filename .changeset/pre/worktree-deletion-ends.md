---
'hoot': patch
---

Deleting a worktree no longer spins forever: `.asar` files, such as the one in an Electron project's dependencies, are deleted like any other file, and a file that cannot be deleted is named within seconds, with the worktree kept to delete again.
