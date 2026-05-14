# oxlint custom Effect rules

We run a set of project-local lint rules that enforce Effect-TS discipline
(no `Effect.ignore`, no `Effect.catchAllCause`, no silent error swallowing,
no `Effect.serviceOption`, etc.). They live in
[`.oxlint/effect-rules.mjs`](../../.oxlint/effect-rules.mjs) and are wired
into `.oxlintrc.json` via `jsPlugins`.

## Where the rules came from

Ported from Mike Arnaldi's `accountability` repo's `eslint.config.mjs`. Mike
created Effect-TS, so his style rules are as close to a canonical Effect
lint config as exists. When you want the original rule body or the
rationale a rule encodes, read his file — it's the source of truth.

- Upstream: <https://github.com/mikearnaldi/accountability>
- The 9 rules ported: `no-disable-validation`,
  `prefer-option-from-nullable`, `pipe-max-arguments`, `no-effect-asvoid`,
  `no-effect-ignore`, `no-effect-catchallcause`, `no-silent-error-swallow`,
  `no-service-option`, `no-nested-layer-provide`.
- Rules deliberately not ported (don't apply here): `import-extensions`,
  `no-sql-type-parameter`, `no-localstorage`, `no-direct-fetch`,
  `no-location-href-redirect`, `no-void-expression`. Add them if scope
  expands.

## oxlint's JS plugin API

oxlint accepts ESLint-v9-compatible plugins via `jsPlugins`. See
<https://oxc.rs/docs/guide/usage/linter/js-plugins>. The shape is plain
ESLint: each rule is `{ meta, create(context) { return { Visitor(node) {} } } }`
and the plugin exports `{ meta: { name }, rules }`. The plugin's `meta.name`
becomes the rule namespace — ours is `effect`, so rule ids are
`effect/no-effect-ignore` etc.

## Gotchas

- **`context.getSourceCode()` is deprecated in ESLint v9.** Use
  `context.sourceCode` and fall back to `getSourceCode()` only if you must.
  Our helper does `context.sourceCode ?? context.getSourceCode()`.
- **`context.report({ data })` values must be strings.** Numbers (e.g.
  `node.arguments.length` in `pipe-max-arguments`) need explicit
  `String(...)` coercion or the message renders wrong.
- **`messageId` works**, even though oxlint's docs example only shows the
  inline `message: "..."` form. Stick with the v9 `messageId` + `messages`
  shape — it matches Mike's source and is easier to maintain.
- **Helpers must live at module scope.** The `unicorn/consistent-function-scoping`
  rule will yell at helpers defined inside `create()` that don't capture
  `context`. Hoist anything that's pure-AST-introspection.

## Adding a new rule

1. Add a `const myRule = { meta, create }` block in
   `.oxlint/effect-rules.mjs`, modeled after the existing ones.
2. Register it in the `plugin.rules` object at the bottom of that file.
3. Turn it on in `.oxlintrc.json` under `rules` as
   `"effect/my-rule": "error"`.
4. `bun run lint` to verify. If you're porting from Mike's repo, copy the
   rule body verbatim — it's already v9-shaped.
