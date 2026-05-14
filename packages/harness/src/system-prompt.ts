import { Chat } from "@effect/ai";

export interface EnvironmentInfo {
  readonly cwd: string;
  readonly platform: string;
  readonly date: Date;
}

export const buildEnvironmentSystemPrompt = (env: EnvironmentInfo): string =>
  `Here is some useful information about the environment you are running in:
<env>
  Working directory: ${env.cwd}
  Platform: ${env.platform}
  Today's date: ${env.date.toDateString()}
</env>`;

export const chatWithEnvironment = (env: EnvironmentInfo) =>
  Chat.fromPrompt([{ role: "system", content: buildEnvironmentSystemPrompt(env) }]);
