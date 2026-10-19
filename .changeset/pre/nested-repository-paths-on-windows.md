---
'hoot': patch
---

On Windows, the paths of nested repositories use `/`, as those of submodules do, and deleting a worktree removes a nested repository inside another one first, and no longer counts it as an uncommitted change of the outer one, or a populated submodule in a subfolder as a foreign repository.
