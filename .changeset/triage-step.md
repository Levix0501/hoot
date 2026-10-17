---
'hoot': minor
---

The built-in workflow now has a single step, Triage (label `triaging`), which judges whether an issue is one piece of work or several and then stops: one piece gets `ready to design` without asking you, and a split you confirm becomes sub-issues labeled `ready to design`, with the issue labeled `waiting on sub-issues`; the Design and Implement steps are gone for now.
