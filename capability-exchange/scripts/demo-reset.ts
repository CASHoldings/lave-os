import { rm } from "node:fs/promises";
import path from "node:path";
import { loadEnvFiles } from "./_env";
loadEnvFiles();

/** Deletes the local embedded demo database and uploaded demo files, then rebuilds them. Never touches DATABASE_URL databases. */
async function main() {
  const { getEnv } = await import("@/config/env");
  const env = getEnv();
  if (env.DATABASE_URL) {
    console.error("demo:reset only works with the embedded demo database. Unset DATABASE_URL to use it.");
    process.exit(1);
  }
  if (env.APP_MODE !== "demo") {
    console.error("Set APP_MODE=demo in .env.local first.");
    process.exit(1);
  }
  const dataRoot = path.resolve(".data");
  for (const dir of [env.PGLITE_DIR, env.LOCAL_STORAGE_DIR]) {
    const full = path.resolve(dir);
    if (!full.startsWith(dataRoot + path.sep)) {
      console.error(`Refusing to delete ${dir}: demo data must live under .data/`);
      process.exit(1);
    }
    await rm(full, { recursive: true, force: true });
  }
  await import("./demo-setup");
}

main().catch((e) => {
  console.error("Demo reset failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
