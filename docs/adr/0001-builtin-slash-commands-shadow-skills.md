# Builtin slash commands shadow skills with the same name

When a user-authored **Skill** shares a name with a **Builtin command**
(e.g. a skill named `clear` collides with `/clear`), the builtin wins
and the skill is dropped from the picker. A `console.warn` at startup
reports both the skill's location and the shadowing builtin.

We picked this over "skill wins" because builtins are the harness's
recovery surface — `/exit` and `/clear` are how a user gets out of a
broken state. Silently disabling them via a misnamed file in
`~/.claude/skills/` (often authored months ago, often shared across
projects) is a worse failure mode than the reverse: a one-line warning
plus an inability to invoke that specific skill until renamed.

We also rejected "collision = hard error / refuse to start": too sharp
for what is almost always a typo, and it removes the harness from the
user just when they'd want it to help them rename.

The precedence rule lives in `slashCommand` and in `listSlashCommands`
(picker source). Both must agree, so they're driven from the same
`BUILTINS` registry — see Q3 / Q8 of `specs/pending/slash-picker.md`.
