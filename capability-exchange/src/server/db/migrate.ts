import path from "node:path";
import type { Database } from "./client";

/** Applies SQL migrations from ./drizzle using the driver that matches the database handle. */
export async function runMigrations(db: Database, driver: "pg" | "pglite") {
  const migrationsFolder = path.join(process.cwd(), "drizzle");
  if (driver === "pg") {
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    await migrate(db as never, { migrationsFolder });
  } else {
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    await migrate(db as never, { migrationsFolder });
  }
}
