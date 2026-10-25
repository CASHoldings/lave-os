import { loadEnvFiles } from "./_env";
loadEnvFiles();

/** Loads fictional demonstration data into an empty database. Refuses to run in production. */
async function main() {
  const { getEnv } = await import("@/config/env");
  const env = getEnv();
  if (env.NODE_ENV === "production" || process.env.NODE_ENV === "production") {
    console.error("Refusing to load demonstration data with NODE_ENV=production.");
    process.exit(1);
  }
  const { closeDb } = await import("@/server/db/client");
  const { seedDemoData, isDatabaseEmpty } = await import("@/server/seed/demo");
  if (!(await isDatabaseEmpty())) {
    console.error("The database already contains users. Demonstration data is only loaded into an empty database.");
    process.exit(1);
  }
  await seedDemoData();
  console.log("Loaded fictional demonstration data.");
  await closeDb();
}

main().catch((e) => {
  console.error("Seed failed:", e instanceof Error ? e.stack : e);
  process.exit(1);
});
