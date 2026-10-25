import { existsSync } from "node:fs";

/** Loads .env.local / .env for command-line scripts (Next.js loads them itself for the app). */
export function loadEnvFiles() {
  for (const file of [".env.local", ".env"]) {
    if (existsSync(file)) process.loadEnvFile(file);
  }
}
