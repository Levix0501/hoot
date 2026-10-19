---
'hoot': patch
---

Hoot now writes the files of an issue it sends to a session to `.hoot/tmp` in the issue's worktree, a folder Git ignores, instead of the system's temporary folder.
