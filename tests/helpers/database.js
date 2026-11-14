import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";

// PostgreSQL compiled to WASM, in memory only. Never uses the user's DATABASE_URL.
// Serialize leased clients because this test engine has one PostgreSQL connection.
export async function testDatabase() {
  const db = new PGlite();
  const schema = await readFile(new URL("../../database/weconnect_weeks_1_2.sql", import.meta.url), "utf8");
  await db.exec(schema);
  let tail = Promise.resolve();
  async function lease() {
    const previous = tail;
    let unlock;
    tail = new Promise(resolve => { unlock = resolve; });
    await previous;
    let released = false;
    return { query: (sql, values) => db.query(sql, values), release() { if (!released) { released = true; unlock(); } } };
  }
  const pool = {
    connect: lease,
    async query(sql, values) {
      const client = await lease();
      try { return await client.query(sql, values); }
      finally { client.release(); }
    },
    async end() { await tail; await db.close(); },
  };
  return { pool, db, schema };
}
