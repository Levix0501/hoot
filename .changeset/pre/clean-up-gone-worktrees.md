---
'hoot': patch
---

A worktree whose folder was deleted, or that Git no longer lists, is cleaned up with its saved sessions when Hoot next reads the worktrees, instead of staying as a Missing row; one with open sessions, a locked one, or one in a project folder on a disk that is not connected stays as missing, and Remove, now available on every missing worktree, closes its open sessions first.
