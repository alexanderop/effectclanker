import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { mockText, mockToolCall, runToolkit, withTmpDir, writeFiles } from "./utilities.ts";

describe("HarnessToolkit driven by generateText", () => {
  it.effect("dispatches a glob tool call to its handler and returns the result", () =>
    withTmpDir("toolkit-dispatch", (dir) =>
      Effect.gen(function* () {
        yield* writeFiles(dir, { "a.ts": "", "b.ts": "" });
        const response = yield* runToolkit({
          prompt: "list ts files",
          parts: [mockToolCall("glob", { pattern: "**/*.ts", cwd: dir })],
        });

        expect(response.toolCalls).toHaveLength(1);
        expect(response.toolCalls[0]?.name).toBe("glob");
        expect(response.toolResults).toHaveLength(1);
        const result = response.toolResults[0]?.result;
        expect((result as ReadonlyArray<string>).toSorted()).toEqual(["a.ts", "b.ts"]);
      }),
    ),
  );

  it.effect("returns plain text when the model produces no tool calls", () =>
    Effect.gen(function* () {
      const response = yield* runToolkit({
        prompt: "hi",
        parts: [mockText("hello back")],
      });

      expect(response.text).toBe("hello back");
      expect(response.toolCalls).toHaveLength(0);
      expect(response.toolResults).toHaveLength(0);
    }),
  );

  it.effect(
    "surfaces handler failures as tool result failures with the typed error in `result`",
    () =>
      Effect.gen(function* () {
        const response = yield* runToolkit({
          prompt: "edit a file that doesn't exist",
          parts: [
            mockToolCall("edit", {
              path: "/no/such/path/xyz",
              oldString: "a",
              newString: "b",
            }),
          ],
        });

        expect(response.toolResults).toHaveLength(1);
        const tr = response.toolResults[0]!;
        expect(tr.isFailure).toBe(true);
        // `failureMode: "return"` puts the structured error in `result`, not in
        // the Effect's error channel. The exact tag depends on platform mapping
        // (NotFound vs FileIOError) so allow either.
        const errorTag = (tr.result as { _tag?: string })._tag;
        expect(["FileNotFound", "FileIOError"]).toContain(errorTag);
      }),
  );

  it.effect("loop continues after a failed tool call — turn 2 sees the result and emits text", () =>
    Effect.gen(function* () {
      // Branch on call number: turn 1 emits a failing tool call, turn 2 emits final text.
      let call = 0;
      const parts = () => {
        call++;
        if (call === 1) {
          return [mockToolCall("read", { path: "/no/such/path/xyz" })];
        }
        return [mockText("I tried, that path is missing.")];
      };

      const turn1 = yield* runToolkit({ prompt: "read the file", parts });
      expect(turn1.toolResults).toHaveLength(1);
      expect(turn1.toolResults[0]!.isFailure).toBe(true);

      const turn2 = yield* runToolkit({ prompt: "what happened?", parts });
      expect(turn2.text).toBe("I tried, that path is missing.");
      expect(turn2.toolCalls).toHaveLength(0);
      expect(call).toBe(2);
    }),
  );

  it.effect("raises MalformedOutput when tool call params fail schema decoding", () =>
    Effect.gen(function* () {
      // glob.params requires `pattern: String`. Sending an empty object should
      // trip schema decoding *before* the handler runs. Mirrors
      // repos/effect/packages/ai/ai/test/Tool.test.ts:185-218.
      const error = yield* runToolkit({
        prompt: "list ts files",
        parts: [mockToolCall("glob", {})],
      }).pipe(Effect.flip);

      expect(error._tag).toBe("MalformedOutput");
      expect((error as { description?: string }).description).toMatch(
        /Failed to decode tool call parameters/,
      );
    }),
  );
});
