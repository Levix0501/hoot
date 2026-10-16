---
'hoot': minor
---

Issues can now be blocked by other issues, as in Linear and GitHub: an issue's page lists what it is blocked by and what it blocks, Blocked by… and Blocking… in its menus add a dependency or create an issue with one, the list shows how many issues each waits on and blocks, and hoot adds and removes dependencies with `issue create` and `issue edit`, shows them in `issue view` and `--json`, and splits an issue into sub-issues with dependencies with the new `issue split`.
