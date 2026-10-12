---
name: split-issue
description: Judge whether a Hoot issue fits one agent session; if not, split it into ordered issues that can each be accepted on its own.
disable-model-invocation: true
---

Here is an issue from Hoot. Its title is the heading; the rest, if any, is its description.

$ARGUMENTS

Judge the issue against this project's code. Read whatever you need, but change nothing: no edits, no commits, no commands that change files.

1. Workload: can one fresh Claude Code session implement the whole issue, and another fresh session then verify it in full? Answer yes or no, and say why: the parts of the code it touches, and what is still unknown. Do not estimate time.
2. If yes, say that it needs no split, and stop.
3. If no, split it into issues that one session can each implement and another verify. Each delivers a narrow but complete result through every layer it touches, never one layer of the whole. For each:
   - Title
   - Description: what it delivers, and how to accept it
   - Waits on: the issues it cannot be delivered and accepted without, or none
4. End with the order, one chain per line, such as `1 → 2 → 4` and `1 → 3`.

Write titles and descriptions in the issue's language. Where the issue leaves open something that changes your answer, say what you assumed.
