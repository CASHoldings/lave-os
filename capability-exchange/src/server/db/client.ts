import { sql } from "drizzle-orm";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from "drizzle-orm/pg-core";
import { mkdirSync } from "node:fs";
import { Pool } from "pg";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import * as schema from "./schema";
import { getEnv } from "@/config/env";

export type Schema = typeof schema;
export type Database = PgDatabase<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;
export type Transaction = PgTransaction<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;
export type DbOrTx = Database | Transaction;

type Holder = { db?: Database; close?: () => Promise<void>; ready?: Promise<void> };
const globalHolder = globalThis as unknown as { __aceDb?: Holder };
const holder: Holder = (globalHolder.__aceDb ??= {});

/**
 * Returns the shared database handle. With DATABASE_URL set, connects to PostgreSQL
 * (Supabase or any other host). Otherwise uses an embedded PGlite database on disk,
 * which is intended for local demo mode only.
 */
export function getDb(): Database {
  if (holder.db) return holder.db;
  const env = getEnv();
  if (env.DATABASE_URL) {
    const pool = new Pool({ connectionString: env.DATABASE_URL, max: 10 });
    holder.db = drizzlePg(pool, { schema }) as unknown as Database;
    holder.close = () => pool.end();
  } else {
    if (env.NODE_ENV === "production") throw new Error("DATABASE_URL is required in production.");
    mkdirSync(env.PGLITE_DIR, { recursive: true });
    const client = new PGlite(env.PGLITE_DIR);
    holder.db = drizzlePglite(client, { schema }) as unknown as Database;
    holder.close = () => client.close();
  }
  return holder.db;
}

/** Tests inject an isolated in-memory database. */
export function setDbForTesting(db: Database | undefined) {
  holder.db = db;
  holder.close = undefined;
}

export async function closeDb() {
  await holder.close?.();
  holder.db = undefined;
  holder.close = undefined;
}

/**
 * Runs `fn` inside a transaction as the restricted `ace_app_user` role with the given
 * user's id set, so row-level security policies apply to organisation-private tables.
 * Only shortlists, shortlist entries and application notes are reachable in this mode.
 */
export async function withOrgRls<T>(userId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select set_config('ace.user_id', ${userId}, true)`);
    await tx.execute(sql`set local role ace_app_user`);
    return fn(tx as Transaction);
  });
}
