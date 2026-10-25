import { defineConfig } from "drizzle-kit";

// Generates SQL migrations from src/server/db/schema.ts into ./drizzle.
// Hand-written migrations (row-level security, search) live alongside them.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
});
