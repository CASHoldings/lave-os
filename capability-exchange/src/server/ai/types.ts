import type { z } from "zod";

export type AiTaskName = "summary" | "rewrite" | "extract" | "follow_up" | "comparison" | "opportunity_clarify";

export interface AiRequest<T> {
  task: AiTaskName;
  /** Fixed instructions. Never contains user-supplied text. */
  system: string;
  /** Permission-filtered, minimised context. Treated as untrusted data by the model. */
  data: unknown;
  /** What to produce, in plain words. */
  instruction: string;
  schema: z.ZodType<T>;
  /** Deterministic, rule-based output used by the demonstration provider. */
  demo: () => T;
}

export interface AiResult<T> {
  data: T;
  provider: "anthropic" | "demo";
  model: string | null;
  /** True when the output came from rules rather than an AI model. Always shown in the UI. */
  isDemonstration: boolean;
}

export interface AiProvider {
  readonly name: "anthropic" | "demo";
  generate<T>(req: AiRequest<T>): Promise<AiResult<T>>;
}

export class AiFailure extends Error {
  constructor(
    message: string,
    public readonly code: "timeout" | "refused" | "invalid_output" | "upstream" | "disabled",
  ) {
    super(message);
  }
}

