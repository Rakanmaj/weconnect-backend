import { readFile } from "node:fs/promises";
import { createPool } from "../db.js";
import { getConfig } from "../config.js";
import { growthCatalogSql } from '../growth-catalog.js';

const pool = createPool(getConfig().databaseUrl);
try {
  const sql = await readFile(new URL("../../database/weconnect_weeks_1_2.sql", import.meta.url), "utf8");
  await pool.query(sql);
  await pool.query(await readFile(new URL('../../database/003_developer_growth.sql',import.meta.url),'utf8'));
  await pool.query(growthCatalogSql());
  await pool.query(await readFile(new URL('../../database/005_exam_integrity.sql',import.meta.url),'utf8'));
  console.log("Weeks 1–4 schema and starter catalogue are ready. Existing accounts and results were preserved.");
} catch (error) {
  console.error("Schema setup failed:", error.code || error.message);
  console.error("Create PostgreSQL first and set DATABASE_URL in backend/.env, or run backend/database/weconnect_weeks_1_4.sql in pgAdmin.");
  process.exitCode = 1;
} finally { await pool.end(); }
