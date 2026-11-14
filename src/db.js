import pg from "pg";

export function createPool(connectionString) {
  if (!connectionString) {
    // Do not silently connect to an unrelated local database using pg defaults.
    const unavailable = async () => {
      const error = new Error("DATABASE_URL is not configured.");
      error.code = "DATABASE_NOT_CONFIGURED";
      throw error;
    };
    return { query: unavailable, connect: unavailable, end: async () => {} };
  }
  const pool = new pg.Pool({ connectionString, max: 10, connectionTimeoutMillis: 5000 });
  pool.on("error", error => console.error("PostgreSQL pool error:", error.code || "connection error"));
  return pool;
}

export async function transaction(pool, operation) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
