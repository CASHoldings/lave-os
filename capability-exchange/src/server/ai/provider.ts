import { getEnv } from "@/config/env";
import { anthropicProvider } from "./anthropic";
import type { AiProvider, AiRequest } from "./types";
export * from "./types";

/** Demonstration provider: rule-based output, clearly labelled. Never used in production. */
export const demoProvider: AiProvider = {
  name: "demo",
  async generate<T>(req: AiRequest<T>) {
    const data = req.schema.parse(req.demo());
    return { data, provider: "demo", model: null, isDemonstration: true };
  },
};

let override: AiProvider | null | undefined;
export function setAiProviderForTesting(p: AiProvider | null | undefined) {
  override = p;
}

/** The configured provider, or null when AI assistance is switched off. */
export function getAiProvider(): AiProvider | null {
  if (override !== undefined) return override;
  const env = getEnv();
  if (env.aiProvider === "anthropic") return anthropicProvider();
  if (env.aiProvider === "demo") return demoProvider;
  return null;
}

export function aiStatus(): { mode: "live" | "demo" | "off"; description: string } {
  const p = getAiProvider();
  if (!p) return { mode: "off", description: "AI assistance is switched off in this environment. Everything else works without it, including the automatic profile checks." };
  if (p.name === "demo") return { mode: "demo", description: "Demonstration mode: suggestions are produced by simple rules, not by an AI model, and are labelled as such." };
  return { mode: "live", description: "Suggestions are drafted by an AI model from your own records. Nothing is saved until you approve it." };
}
