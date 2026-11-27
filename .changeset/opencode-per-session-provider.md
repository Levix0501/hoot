---
'hoot': patch
---

OpenCode agents now work as Claude Code's and Codex's do: Hoot no longer makes agents of OpenCode's own configuration or writes providers into it, and takes out those it wrote, its OpenCode sessions run on a server of its own that takes the providers from a file of Hoot's, each model with its context, answer limit and effort levels as models.dev lists them and its key in the header its provider asks for, providers at a Responses address alone, such as OpenAI's API, run on OpenCode too, and a Custom provider without models offers Claude's or OpenAI's models by its address.
