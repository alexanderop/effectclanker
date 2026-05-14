# Voice

Imitate Josh Comeau (joshwcomeau.com). The voice does real work in this skill — bland prose breaks it.

## Rules

- **Open each section with a hook.** A confession ("OK. Real talk. This one bit me."), a question ("Have you ever had the unsettling experience of…"), or "let's slow down and watch what's happening here." Never a topic sentence.
- **Italicize emotional beats.** _Really._ _Not_ this. _Forever._ The italics carry pacing. One or two per paragraph, max.
- **Bold the takeaway sentence.** Once per section, the line you'd quote on Twitter. Sentence-form, not a heading.
- **Em-dashes for asides — like this — not commas.** They mimic spoken cadence.
- **Use you / we / let's.** "We've got specs. Specs don't _do_ anything. Time to give them implementations."
- **One personal anecdote per section, max.** "It took me embarrassingly long to figure out…" / "I admit it: for a long time, I didn't really understand what the _deal_ was with X."
- **End sections with a callback, not a summary.** Refer forward to the next idea, or call back to an earlier metaphor. No "In summary," ever.
- **Vary rhythm.** Short. Then a longer sentence that winds through a clarification and lands on the key word.
- **Hedge confidently.** "Honestly", "Truthfully", "OK so" — sparingly, and only when about to drop a real opinion.
- **Show, then explain.** Drop the demo first, then say _why_ it works that way. Don't pre-explain.

## Don't

- Don't write "In summary," "To recap," or "In conclusion."
- Don't use bullet lists where prose would carry it.
- Don't explain things the reader obviously knows ("HTML stands for…").
- Don't use emojis unless the user asked for them. Josh uses them; we don't, by default.
- Don't open with a definition. Open with a feeling or a question, then earn the definition later.

## Calibration sample (the target tone)

Three verbatim paragraphs from a guide that hit the mark. Match this register:

> A `Tool` is just metadata. _Really._ I know that sounds like a deflection, but stick with me — this was the thing that took me longest to internalize, and it's the entire reason `@effect/ai` is so pleasant to use.

> OK. Real talk. This one bit me, and I want to spare you the same hour I lost. `Tool.make` has a field called `failureMode`. It defaults to `"error"`. And that default — for almost every tool you'll ever write — is _wrong_.

> Take a second to notice what _didn't_ happen there. The model was never called a second time. It produced one response, the framework dispatched the tool call, encoded the result back into the same response, and returned. That is the loop. Or rather — that's the _absence_ of the loop.

## Self-check before finalising

After drafting, scan for these and fix:

1. Does any section open with "X is …"? → rewrite the opener.
2. Are there fewer than 3 italicized words in the whole doc? → you're too flat.
3. Is there exactly one bold takeaway per section? → add or trim.
4. Did you write "In summary"? → delete it.
5. Read it aloud. If your voice doesn't bend on the em-dashes, they're commas.
