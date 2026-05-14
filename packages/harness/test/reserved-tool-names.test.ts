import { describe, expect, it } from "@effect/vitest";
import { HarnessToolkit } from "../src/toolkit.ts";

// Anthropic reserves these names for its provider-defined (server-side) tools.
// `@effect/ai-anthropic` unconditionally rewrites incoming `tool_use.name`
// matching this set to the corresponding `AnthropicXxx` toolkit name *before*
// the toolkit's response schema decodes the part — so a custom tool sharing
// any of these names will crash the stream with a schema decode error.
//
// Source: `repos/effect/packages/ai/anthropic/src/AnthropicTool.ts` →
// `ProviderToolNamesMap`. See also docs/patterns/effect-ai-gotchas.md §4.
const ANTHROPIC_RESERVED_TOOL_NAMES = new Set([
  "bash",
  "code_execution",
  "computer",
  "str_replace_based_edit_tool",
  "str_replace_editor",
  "web_search",
]);

describe("HarnessToolkit reserved-name guard", () => {
  it("no registered tool name collides with an Anthropic provider-defined tool", () => {
    const collisions = Object.keys(HarnessToolkit.tools).filter((name) =>
      ANTHROPIC_RESERVED_TOOL_NAMES.has(name),
    );
    expect(collisions).toEqual([]);
  });
});
