import { loadEnvFiles } from "./_env";
loadEnvFiles();

async function main() {
  const { getDb, closeDb } = await import("@/server/db/client");
  const { runMigrations } = await import("@/server/db/migrate");
  const { getEnv } = await import("@/config/env");
  const env = getEnv();
  await runMigrations(getDb(), env.DATABASE_URL ? "pg" : "pglite");
  console.log(`Migrations applied (${env.DATABASE_URL ? "PostgreSQL" : `embedded PGlite at ${env.PGLITE_DIR}`}).`);
  await closeDb();
}

main().catch((e) => {
  console.error("Migration failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
