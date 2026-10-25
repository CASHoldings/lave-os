import { loadEnvFiles } from "./_env";
loadEnvFiles();

/** Prepares the local demo database: applies migrations and loads fictional data if it is empty. */
async function main() {
  const { getEnv } = await import("@/config/env");
  const env = getEnv();
  if (env.APP_MODE !== "demo") {
    console.error("Set APP_MODE=demo in .env.local to use the demo setup (see .env.example).");
    process.exit(1);
  }
  const { getDb, closeDb } = await import("@/server/db/client");
  const { runMigrations } = await import("@/server/db/migrate");
  const { seedDemoData, isDatabaseEmpty } = await import("@/server/seed/demo");
  const db = getDb();
  await runMigrations(db, env.DATABASE_URL ? "pg" : "pglite");
  if (await isDatabaseEmpty()) {
    await seedDemoData();
    console.log("Loaded fictional demonstration data.");
  } else {
    console.log("Database already has data; leaving it as it is. Run `npm run demo:reset` to start again.");
  }
  await closeDb();
}

main().catch((e) => {
  console.error("Demo setup failed:", e instanceof Error ? e.stack : e);
  process.exit(1);
});
