---
'hoot': patch
---

`Merge into <branch> ▸` now hands the merge to the agent you pick straight away, telling it only which branches to merge into which, and leaves it to the agent how to merge and what to do about uncommitted changes, sessions still running in the worktree, a lock, a HEAD on no branch, a merge or rebase in progress or nothing left to merge, which Hoot no longer checks first.
