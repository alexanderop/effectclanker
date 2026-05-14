import { spawn } from "node:child_process";

// Per-platform CLI tools that read text on stdin and stash it on the system
// clipboard. Linux entries are tried in order until one succeeds — installs
// vary (X11 / Wayland / minimal containers).
const platformCandidates = (): ReadonlyArray<readonly [string, ReadonlyArray<string>]> => {
  switch (process.platform) {
    case "darwin":
      return [["pbcopy", []]];
    case "win32":
      return [["clip", []]];
    case "linux":
      return [
        ["wl-copy", []],
        ["xclip", ["-selection", "clipboard"]],
        ["xsel", ["--clipboard", "--input"]],
      ];
    default:
      return [];
  }
};

const trySpawn = (cmd: string, args: ReadonlyArray<string>, text: string): Promise<boolean> =>
  new Promise((resolve) => {
    try {
      const child = spawn(cmd, [...args], { stdio: ["pipe", "ignore", "ignore"] });
      child.on("error", () => resolve(false));
      child.on("close", (code) => resolve(code === 0));
      child.stdin.end(text);
    } catch {
      resolve(false);
    }
  });

// Best-effort copy. Resolves `true` on the first candidate that exits 0 and
// `false` if every candidate fails (or none exists for this platform).
// Never throws — UI code can fire-and-forget. Candidates are tried
// sequentially via promise chaining so we stop at the first success rather
// than spawning every helper in parallel.
export const copyToClipboard = (text: string): Promise<boolean> =>
  platformCandidates().reduce<Promise<boolean>>(
    (acc, [cmd, args]) => acc.then((ok) => (ok ? true : trySpawn(cmd, args, text))),
    Promise.resolve(false),
  );
