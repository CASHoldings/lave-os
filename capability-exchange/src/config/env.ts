import { z } from "zod";

/**
 * Server configuration, validated once and read lazily so `next build` does not
 * need runtime secrets. Demo mode is refused outright in production.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_MODE: z.enum(["demo", "standard"]).default("standard"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().optional(),
  PGLITE_DIR: z.string().default(".data/pglite"),
  AUTH_PROVIDER: z.enum(["password", "supabase"]).default("password"),
  SESSION_SECRET: z.string().optional(),
  STORAGE_PROVIDER: z.enum(["local", "supabase"]).default("local"),
  LOCAL_STORAGE_DIR: z.string().default(".data/uploads"),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_STORAGE_BUCKET: z.string().default("evidence"),
  AI_PROVIDER: z.enum(["anthropic", "demo", "none"]).optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-5-5"),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  AI_HOURLY_LIMIT: z.coerce.number().int().positive().default(30),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(10),
});

export type Env = z.infer<typeof schema> & { aiProvider: "anthropic" | "demo" | "none" };

let cached: Env | null = null;

export class ConfigError extends Error {}

export function parseEnv(source: Record<string, string | undefined>): Env {
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v !== ""));
  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new ConfigError(`Invalid configuration for: ${fields}`);
  }
  const env = parsed.data;

  if (env.NODE_ENV === "production") {
    if (env.APP_MODE === "demo") {
      throw new ConfigError("APP_MODE=demo is not allowed when NODE_ENV=production. Demo sign-in must never run in production.");
    }
    if (!env.DATABASE_URL) throw new ConfigError("DATABASE_URL is required in production.");
    if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) {
      throw new ConfigError("SESSION_SECRET must be at least 32 characters in production.");
    }
    if (!env.APP_URL.startsWith("https://")) throw new ConfigError("APP_URL must use https:// in production.");
  }
  if (env.AUTH_PROVIDER === "supabase" && (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY)) {
    throw new ConfigError("AUTH_PROVIDER=supabase requires SUPABASE_URL and SUPABASE_ANON_KEY.");
  }
  if (env.STORAGE_PROVIDER === "supabase" && (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY)) {
    throw new ConfigError("STORAGE_PROVIDER=supabase requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  }

  // AI: an explicit choice wins; otherwise live AI if a key exists, demo responses in demo mode, else off.
  let aiProvider: Env["aiProvider"] = env.AI_PROVIDER ?? (env.ANTHROPIC_API_KEY ? "anthropic" : env.APP_MODE === "demo" ? "demo" : "none");
  if (aiProvider === "anthropic" && !env.ANTHROPIC_API_KEY) aiProvider = "none";
  if (aiProvider === "demo" && env.NODE_ENV === "production") aiProvider = "none";

  return { ...env, aiProvider };
}

export function getEnv(): Env {
  if (!cached) cached = parseEnv(process.env as Record<string, string | undefined>);
  return cached;
}

/** Test helper: forget the cached configuration. */
export function resetEnvForTesting() {
  cached = null;
}

/**
 * Demo sign-in (one-click personas) is only possible when explicitly in demo mode
 * and never when NODE_ENV is production. Checked at request time, not build time.
 */
export function isDemoMode(): boolean {
  const env = getEnv();
  return env.APP_MODE === "demo" && env.NODE_ENV !== "production" && process.env.NODE_ENV !== "production";
}

export function sessionSecret(): string {
  const env = getEnv();
  if (env.SESSION_SECRET) return env.SESSION_SECRET;
  // Development and demo only: production refuses to start without SESSION_SECRET.
  return "development-only-session-secret-do-not-use-in-production";
}
