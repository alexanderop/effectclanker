# Mark the system prompt with `anthropic.cacheControl`; defer message-history caching

Hit Anthropic's 50k input-tokens-per-minute rate limit on Haiku because the
**Tool** definitions plus the system prompt run several thousand input tokens,
and the **Round** loop re-sends them on every model call. We added a single
`cacheControl: { type: "ephemeral" }` (5-minute TTL) marker on the system
message in `packages/harness/src/system-prompt.ts`; Anthropic's prefix caching
covers the tool definitions before that breakpoint as a side effect, and
cache-read tokens do not count against ITPM.

We deliberately chose this over opencode's full
`repos/opencode/packages/llm/src/cache-policy.ts` — which additionally marks
the latest user message every **Round** to cache the message history. That is
a dollar-cost optimization, not a rate-limit fix; we want evidence of
expensive sessions before adding per-round breakpoint logic and the
4-marker-budget tracking it requires.

Verification lives in the chat footer: a pi-style stats line (`↑in ↓out
Rcache-read Wcache-write`) renders cumulative `Response.Usage` from each
**Round**'s `finish` event, so a regression that drops the breakpoint shows up
as `R0` in the next session.
