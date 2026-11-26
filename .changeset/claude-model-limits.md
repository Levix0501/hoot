---
'hoot': patch
---

Claude Code agents on a provider now tell Claude Code their model's context and answer limits from models.dev, so Claude Code no longer warns that it does not recognize the model, no longer runs a smaller model as if it took a million tokens, and no longer cuts answers off at 32,000 tokens.
