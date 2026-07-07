// Regression tests for the schema-migration runner (Fase 5 bug class C:
// "migrating from an empty DB reaches the current version with every table").
// The v2 RAG migration was the first real migration; nothing guarded that the
// runner applies pending migrations in order, exactly once, each atomically.
//
// We drive runMigrations against a faithful in-memory fake of the expo-sqlite
// surface it uses (getFirstAsync/execAsync/withTransactionAsync). A real engine
// isn't an option in CI: node:sqlite needs an experimental flag on the Node 22
// the workflow runs. The fake records an ordered event log so we can assert the
// chain, the ordering, and that each migration + its version bump run inside a
// transaction.

import { runMigrations, MIGRATIONS } from "../database";

// expo-sqlite is never actually opened here (we pass the fake straight to
// runMigrations); mock it so importing the module doesn't touch native.
jest.mock("expo-sqlite", () => ({ openDatabaseAsync: jest.fn() }));

type Event =
  | { type: "tx-start" }
  | { type: "tx-end" }
  | { type: "sql"; sql: string; inTx: boolean }
  | { type: "pragma"; version: number; inTx: boolean };

function makeFakeDb(startVersion: number) {
  let userVersion = startVersion;
  let txDepth = 0;
  const events: Event[] = [];

  const db = {
    async getFirstAsync<T>(sql: string): Promise<T | null> {
      if (/PRAGMA\s+user_version/i.test(sql)) {
        return { user_version: userVersion } as unknown as T;
      }
      return null;
    },
    async execAsync(sql: string): Promise<void> {
      const m = sql.match(/PRAGMA\s+user_version\s*=\s*(\d+)/i);
      if (m) {
        userVersion = parseInt(m[1], 10);
        events.push({ type: "pragma", version: userVersion, inTx: txDepth > 0 });
      } else {
        events.push({ type: "sql", sql, inTx: txDepth > 0 });
      }
    },
    async withTransactionAsync(cb: () => Promise<void>): Promise<void> {
      txDepth++;
      events.push({ type: "tx-start" });
      try {
        await cb();
      } finally {
        events.push({ type: "tx-end" });
        txDepth--;
      }
    },
  };

  return {
    db: db as unknown as import("expo-sqlite").SQLiteDatabase,
    events,
    version: () => userVersion,
  };
}

const LATEST = MIGRATIONS[MIGRATIONS.length - 1].version;

describe("runMigrations — migration chain", () => {
  it("from an empty DB (v0) applies every migration in order and reaches the latest version", async () => {
    const fake = makeFakeDb(0);
    await runMigrations(fake.db);

    expect(fake.version()).toBe(LATEST);

    // Each migration ran inside its own transaction, SQL before the version bump.
    const migrationSqls = fake.events
      .filter((e): e is Extract<Event, { type: "sql" }> => e.type === "sql")
      .map((e) => e.sql);
    expect(migrationSqls).toEqual(MIGRATIONS.map((m) => m.sql));
    for (const e of fake.events) {
      if (e.type === "sql" || e.type === "pragma") expect(e.inTx).toBe(true);
    }

    // Version bumps happened in ascending order, one per migration.
    const pragmas = fake.events
      .filter((e): e is Extract<Event, { type: "pragma" }> => e.type === "pragma")
      .map((e) => e.version);
    expect(pragmas).toEqual(MIGRATIONS.map((m) => m.version));
  });

  it("from a partially-migrated DB applies only the pending migrations", async () => {
    // Pretend the DB is already at version 1: only later migrations should run.
    const fake = makeFakeDb(1);
    await runMigrations(fake.db);

    expect(fake.version()).toBe(LATEST);
    const ranSqls = fake.events
      .filter((e): e is Extract<Event, { type: "sql" }> => e.type === "sql")
      .map((e) => e.sql);
    const expected = MIGRATIONS.filter((m) => m.version > 1).map((m) => m.sql);
    expect(ranSqls).toEqual(expected);
  });

  it("is idempotent: an already-current DB runs no migrations", async () => {
    const fake = makeFakeDb(LATEST);
    await runMigrations(fake.db);

    expect(fake.version()).toBe(LATEST);
    expect(fake.events).toHaveLength(0);
  });
});

describe("MIGRATIONS — well-formedness", () => {
  it("versions are contiguous starting at 1", () => {
    const versions = MIGRATIONS.map((m) => m.version);
    expect(versions).toEqual(versions.map((_, i) => i + 1));
  });

  it("each migration has non-empty SQL", () => {
    for (const m of MIGRATIONS) {
      expect(m.sql.trim().length).toBeGreaterThan(0);
    }
  });

  it("the v2 migration creates the RAG tables (documents + chunks with an embedding BLOB)", () => {
    const v2 = MIGRATIONS.find((m) => m.version === 2);
    expect(v2).toBeDefined();
    expect(v2!.sql).toMatch(/CREATE TABLE IF NOT EXISTS documents/i);
    expect(v2!.sql).toMatch(/CREATE TABLE IF NOT EXISTS chunks/i);
    expect(v2!.sql).toMatch(/embedding BLOB/i);
  });

  it("the v1 migration creates the models table", () => {
    const v1 = MIGRATIONS.find((m) => m.version === 1);
    expect(v1).toBeDefined();
    expect(v1!.sql).toMatch(/CREATE TABLE IF NOT EXISTS models/i);
  });
});
