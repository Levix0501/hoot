---
'hoot': patch
---

Codex 0.148 and later tell Hoot which conversation each Codex session is in, through a hook Hoot gives them on the command line that Codex asks you to trust once, so that Codex sessions side by side in one folder, and Codex run outside Hoot in that folder, no longer take each other's conversations; without that trust Hoot still finds a session's conversation in Codex's records when the agent ends, now skipping ones that never got a message.
