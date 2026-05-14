import { Box, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatStateController, ChatStateSnapshot, TranscriptEntry } from "./chat-state.ts";
import { copyToClipboard } from "./clipboard.ts";
import type { PendingApproval } from "./approval-ink.ts";

// --- hooks & helpers -------------------------------------------------------

const useChatState = (controller: ChatStateController): ChatStateSnapshot => {
  const [state, setState] = useState<ChatStateSnapshot>(() => controller.snapshot());
  useEffect(() => controller.subscribe(setState), [controller]);
  return state;
};

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const useSpinner = (active: boolean): string => {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!active) {
      setFrame(0);
      return;
    }
    const id = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), 80);
    return () => clearInterval(id);
  }, [active]);
  return SPINNER_FRAMES[frame] ?? "⠋";
};

const readGitBranch = (): string | null => {
  try {
    const head = join(process.cwd(), ".git", "HEAD");
    if (!existsSync(head)) return null;
    const raw = readFileSync(head, "utf8").trim();
    const match = /ref:\s*refs\/heads\/(.+)/u.exec(raw);
    return match ? (match[1] ?? null) : raw.slice(0, 7);
  } catch {
    return null;
  }
};

const displayCwd = (): string => {
  const cwd = process.cwd();
  const home = homedir();
  return home && cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd;
};

const truncate = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max)}…` : text;

const shortenPath = (path: string): string => {
  const home = homedir();
  if (home && path.startsWith(`${home}/`)) return `~${path.slice(home.length)}`;
  const cwd = process.cwd();
  if (path.startsWith(`${cwd}/`)) return path.slice(cwd.length + 1);
  return path;
};

type ToolTitle = { readonly name: string; readonly arg: string };

const formatToolTitle = (name: string, params: unknown): ToolTitle => {
  const p = (params ?? {}) as Record<string, unknown>;
  switch (name) {
    case "shell": {
      const command = typeof p["command"] === "string" ? (p["command"] as string) : "";
      return { name: `$ ${command}`, arg: "" };
    }
    case "read":
    case "edit":
    case "write": {
      const path = typeof p["path"] === "string" ? shortenPath(p["path"] as string) : "";
      return { name, arg: path };
    }
    case "glob": {
      const pattern = typeof p["pattern"] === "string" ? (p["pattern"] as string) : "";
      return { name, arg: pattern };
    }
    case "grep": {
      const pattern = typeof p["pattern"] === "string" ? `"${p["pattern"] as string}"` : "";
      const path = typeof p["path"] === "string" ? ` ${shortenPath(p["path"] as string)}` : "";
      return { name, arg: `${pattern}${path}` };
    }
    default: {
      if (params === undefined || params === null) return { name, arg: "" };
      if (typeof params === "string") return { name, arg: truncate(params, 200) };
      return { name, arg: truncate(JSON.stringify(params), 200) };
    }
  }
};

const RESULT_PREVIEW_LINES = 10;

type ToolOutput = { readonly lines: ReadonlyArray<string>; readonly remaining: number };

const formatToolOutput = (result: unknown, maxLines: number): ToolOutput => {
  const raw =
    result === null || result === undefined
      ? String(result)
      : typeof result === "string"
        ? result
        : JSON.stringify(result, null, 2);
  const all = raw.split("\n");
  while (all.length > 0 && all[all.length - 1] === "") all.pop();
  const lines = all.slice(0, maxLines);
  return { lines, remaining: Math.max(0, all.length - maxLines) };
};

const describePendingApproval = (pending: PendingApproval): string => {
  const r = pending.request;
  switch (r.kind) {
    case "shell":
      return `Run shell: ${r.command ?? ""}`;
    case "write":
      return `Write file: ${r.path ?? ""}`;
    case "edit":
      return `Edit file: ${r.path ?? ""}`;
    case "apply_patch":
      return "Apply patch to one or more files";
  }
};

// --- grouping --------------------------------------------------------------

// A paired tool-call + tool-result pi-style "card". The renderer collapses
// adjacent tool-call/tool-result transcript entries with the same id into one.
type ToolGroup = {
  readonly kind: "tool";
  readonly id: string;
  readonly name: string;
  readonly params: unknown;
  readonly result?: { readonly isFailure: boolean; readonly result: unknown };
};

type RenderGroup = TranscriptEntry | ToolGroup;

const groupTranscript = (entries: ReadonlyArray<TranscriptEntry>): ReadonlyArray<RenderGroup> => {
  const groups: RenderGroup[] = [];
  const indexById = new Map<string, number>();
  for (const entry of entries) {
    if (entry.kind === "tool-call") {
      indexById.set(
        entry.id,
        groups.push({
          kind: "tool",
          id: entry.id,
          name: entry.name,
          params: entry.params,
        }) - 1,
      );
      continue;
    }
    if (entry.kind === "tool-result") {
      const idx = indexById.get(entry.id);
      if (idx !== undefined) {
        const existing = groups[idx] as ToolGroup;
        groups[idx] = {
          ...existing,
          result: { isFailure: entry.isFailure, result: entry.result },
        };
        continue;
      }
    }
    groups.push(entry);
  }
  return groups;
};

// --- visual blocks ---------------------------------------------------------

const USER_BG = "#343541";

const UserBubble: React.FC<{ readonly text: string }> = ({ text }) => (
  <Box marginTop={1} paddingX={1}>
    <Text backgroundColor={USER_BG} color="white">
      {` ${text} `}
    </Text>
  </Box>
);

const AssistantBubble: React.FC<{
  readonly text: string;
  readonly streaming: boolean;
}> = ({ streaming, text }) => (
  <Box marginTop={1} paddingX={1}>
    <Text>
      {text}
      {streaming ? <Text dimColor>{" ▍"}</Text> : null}
    </Text>
  </Box>
);

const SystemBubble: React.FC<{ readonly text: string }> = ({ text }) => (
  <Box paddingX={1}>
    <Text dimColor italic>
      {text}
    </Text>
  </Box>
);

// Multi-line bordered card. The body is a single Text node on its own line
// so terminal mouse-selection can grab the message cleanly without dragging
// across the title or the copy hint. The hint only renders on the most
// recent error so older entries don't all advertise the same shortcut.
const ErrorBubble: React.FC<{
  readonly message: string;
  readonly showCopyHint: boolean;
}> = ({ message, showCopyHint }) => (
  <Box marginTop={1} borderStyle="round" borderColor="red" paddingX={1} flexDirection="column">
    <Text color="red" bold>
      ✗ Error
    </Text>
    <Box marginTop={1}>
      <Text color="red">{message}</Text>
    </Box>
    {showCopyHint ? (
      <Box marginTop={1}>
        <Text dimColor>Press Ctrl+E to copy this error to the clipboard</Text>
      </Box>
    ) : null}
  </Box>
);

// Pi-style tool block — no border, just a subtle background tint
// (toolPendingBg / toolSuccessBg / toolErrorBg from pi's dark theme) plus a
// bold title line and a dim multi-line output preview underneath.
const TOOL_PENDING_BG = "#282832";
const TOOL_SUCCESS_BG = "#283228";
const TOOL_ERROR_BG = "#3c2828";

const ToolCard: React.FC<{ readonly group: ToolGroup }> = ({ group }) => {
  const status: "pending" | "success" | "error" =
    group.result === undefined ? "pending" : group.result.isFailure ? "error" : "success";
  const bg =
    status === "pending" ? TOOL_PENDING_BG : status === "error" ? TOOL_ERROR_BG : TOOL_SUCCESS_BG;
  const titleColor = status === "error" ? "red" : "cyan";
  const title = formatToolTitle(group.name, group.params);
  const output =
    group.result === undefined ? null : formatToolOutput(group.result.result, RESULT_PREVIEW_LINES);

  return (
    <Box marginTop={1} paddingX={1} flexDirection="column" backgroundColor={bg}>
      <Text backgroundColor={bg}>
        <Text bold color={titleColor} backgroundColor={bg}>
          {title.name}
        </Text>
        {title.arg ? <Text color="cyan" backgroundColor={bg}>{` ${title.arg}`}</Text> : null}
      </Text>
      {output === null ? (
        <Text italic dimColor backgroundColor={bg}>
          …running
        </Text>
      ) : output.lines.length === 0 && output.remaining === 0 ? null : (
        <Box flexDirection="column" backgroundColor={bg}>
          {output.lines.map((line, i) => (
            <Text key={i} color="gray" backgroundColor={bg}>
              {line}
            </Text>
          ))}
          {output.remaining > 0 ? (
            <Text dimColor backgroundColor={bg}>{`… (${output.remaining} more lines)`}</Text>
          ) : null}
        </Box>
      )}
    </Box>
  );
};

// --- main app --------------------------------------------------------------

interface ChatAppProps {
  readonly controller: ChatStateController;
  readonly model: string;
  readonly approvalMode: "auto" | "interactive" | "deny";
  readonly onSubmit: (line: string) => void;
  readonly onCancel: () => void;
  readonly onExit: () => void;
  readonly pendingApproval: PendingApproval | null;
  readonly onApprovalDecision: (approve: boolean) => void;
}

export const ChatApp: React.FC<ChatAppProps> = ({
  approvalMode,
  controller,
  model,
  onApprovalDecision,
  onCancel,
  onExit,
  onSubmit,
  pendingApproval,
}) => {
  const state = useChatState(controller);
  const [draft, setDraft] = useState("");
  const [copyToast, setCopyToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { exit } = useApp();
  const spinnerFrame = useSpinner(state.status === "streaming");

  const cwdDisplay = useMemo(() => displayCwd(), []);
  const branch = useMemo(() => readGitBranch(), []);
  const pwdLine = branch === null ? cwdDisplay : `${cwdDisplay} (${branch})`;

  const lastErrorMessage = useMemo<string | null>(() => {
    const last = state.transcript.findLast((e) => e.kind === "error");
    return last && last.kind === "error" ? last.message : null;
  }, [state.transcript]);

  useEffect(
    () => () => {
      if (toastTimer.current !== null) clearTimeout(toastTimer.current);
    },
    [],
  );

  const showToast = (message: string): void => {
    if (toastTimer.current !== null) clearTimeout(toastTimer.current);
    setCopyToast(message);
    toastTimer.current = setTimeout(() => {
      setCopyToast(null);
      toastTimer.current = null;
    }, 2500);
  };

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      if (state.status === "streaming") {
        onCancel();
        return;
      }
      if (draft.length === 0) {
        onExit();
        exit();
        return;
      }
      setDraft("");
      return;
    }
    if (key.ctrl && input === "e") {
      if (lastErrorMessage === null) {
        showToast("No error to copy.");
        return;
      }
      const text = lastErrorMessage;
      copyToClipboard(text).then(
        (ok) =>
          showToast(
            ok
              ? "Copied error to clipboard."
              : "Copy failed — install pbcopy / xclip / xsel / wl-copy.",
          ),
        () => showToast("Copy failed."),
      );
      return;
    }
    if (pendingApproval !== null) {
      if (input === "y" || input === "Y") {
        onApprovalDecision(true);
      } else if (input === "n" || input === "N" || key.return) {
        onApprovalDecision(false);
      }
    }
  });

  const groups = useMemo(() => groupTranscript(state.transcript), [state.transcript]);
  const lastErrorIdx = useMemo(() => {
    for (let i = groups.length - 1; i >= 0; i--) {
      if (groups[i]?.kind === "error") return i;
    }
    return -1;
  }, [groups]);
  const lastGroup = groups.at(-1);
  const showThinking =
    state.status === "streaming" &&
    (lastGroup === undefined ||
      lastGroup.kind === "user" ||
      lastGroup.kind === "tool" ||
      lastGroup.kind === "system");

  const planLine =
    state.plan.length > 0
      ? state.plan
          .map((p) =>
            p.status === "completed"
              ? `[x] ${p.step}`
              : p.status === "in_progress"
                ? `[~] ${p.step}`
                : `[ ] ${p.step}`,
          )
          .join("  ")
      : null;

  return (
    <Box flexDirection="column">
      <Box>
        <Text color="cyan" bold>
          ◆ effectclanker
        </Text>
        <Text dimColor> — type a prompt, /help for commands</Text>
      </Box>

      {groups.map((group, idx) => {
        switch (group.kind) {
          case "user":
            return <UserBubble key={idx} text={group.text} />;
          case "assistant":
            return (
              <AssistantBubble
                key={idx}
                text={group.text}
                streaming={state.status === "streaming" && idx === groups.length - 1}
              />
            );
          case "tool":
            return <ToolCard key={idx} group={group} />;
          case "system":
            return <SystemBubble key={idx} text={group.text} />;
          case "error":
            return (
              <ErrorBubble key={idx} message={group.message} showCopyHint={idx === lastErrorIdx} />
            );
          case "tool-call":
          case "tool-result":
            return null;
        }
      })}

      {showThinking ? (
        <Box marginTop={1} paddingX={1}>
          <Text color="cyan">{spinnerFrame} </Text>
          <Text dimColor italic>
            thinking…{" "}
          </Text>
          <Text dimColor>(Ctrl+C to cancel)</Text>
        </Box>
      ) : null}

      {pendingApproval !== null && (
        <Box
          marginTop={1}
          borderStyle="round"
          borderColor="yellow"
          paddingX={1}
          flexDirection="column"
        >
          <Text>
            <Text color="yellow" bold>
              approve?
            </Text>{" "}
            {describePendingApproval(pendingApproval)}
          </Text>
          <Text dimColor>[y] approve · [N] deny</Text>
        </Box>
      )}

      {copyToast !== null ? (
        <Box marginTop={1} paddingX={1}>
          <Text color="cyan">{copyToast}</Text>
        </Box>
      ) : null}

      <Box marginTop={1} flexDirection="column">
        <Text dimColor>{pwdLine}</Text>
        <Text dimColor>
          {`${model} • approval ${approvalMode} • ${state.status}`}
          {planLine === null ? "" : ` • plan: ${planLine}`}
        </Text>
      </Box>

      <Box
        marginTop={1}
        borderStyle="round"
        borderColor={state.status === "streaming" ? "gray" : "cyan"}
        paddingX={1}
      >
        <Text color="cyan" bold>
          {"> "}
        </Text>
        <TextInput
          value={draft}
          onChange={setDraft}
          onSubmit={(value) => {
            if (state.status === "streaming") return;
            if (pendingApproval !== null) return;
            if (value.length === 0) return;
            setDraft("");
            onSubmit(value);
          }}
        />
      </Box>
    </Box>
  );
};
