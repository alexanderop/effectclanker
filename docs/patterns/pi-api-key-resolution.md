# Pi's API key resolution

Reference note. Read when planning multi-provider auth or moving keys off
disk. Not implemented in effectclanker yet — `src/cli.ts` reads
`ANTHROPIC_API_KEY` directly via `Config.redacted(...)`.

## Three-layer priority

From `repos/pi/packages/coding-agent/src/core/auth-storage.ts:446-516`:

1. **CLI `--api-key` runtime override** — in-process only, beats everything.
2. **`~/.pi/agent/auth.json`** — global JSON, `0600` perms
   (`auth-storage.ts:107`). Shape:
   ```json
   { "anthropic": { "type": "api_key", "key": "sk-ant-..." } }
   ```
3. **Environment variable** — `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` /
   etc. Full provider→env-var map in
   `repos/pi/packages/ai/src/env-api-keys.ts:101`.

OAuth subscriptions (Claude Pro/Max, ChatGPT Plus/Pro, GitHub Copilot)
also live in `auth.json` under the same provider keys, with auto-refresh
under a file lock — same file, different `type: "oauth"` shape.

## The `key` field is a mini-DSL

`resolveConfigValue` in
`repos/pi/packages/coding-agent/src/core/resolve-config-value.ts:17`
accepts three forms:

- `"!security find-generic-password -ws 'anthropic'"` — leading `!`
  executes the rest as a shell command, uses stdout, cached for the
  process lifetime. Lets keys live in macOS Keychain, 1Password CLI,
  etc. — never on disk.
- `"MY_ANTHROPIC_KEY"` — bare string that matches an existing env var
  name is dereferenced.
- `"sk-ant-..."` — literal, used as-is.

The same resolver is reused for HTTP header values (`resolveHeaders`).

## Why this is interesting for effectclanker

- Bun auto-loads `.env`, which already covers the env-var layer for
  free. Good enough as a starting point.
- The win pi has over a plain `.env` is the `!cmd` indirection plus a
  single global file shared across projects. Worth porting if/when we
  add a second provider or care about not having raw secrets on disk.
- Pi has **no `.env` support**. It expects an exported env var or
  `auth.json`. If we want both worlds, our resolver should layer on top
  of Bun's `.env` autoload rather than replace it.
