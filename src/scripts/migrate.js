import { readFile } from "node:fs/promises";
import { createPool } from "../db.js";
import { getConfig } from "../config.js";
import { growthCatalogSql, refreshAssessmentCatalogSql, refreshChallengeLessonsSql } from '../growth-catalog.js';

const pool = createPool(getConfig().databaseUrl);
try {
  const sql = await readFile(new URL("../../database/weconnect_weeks_1_2.sql", import.meta.url), "utf8");
  await pool.query(sql);
  await pool.query(await readFile(new URL('../../database/003_developer_growth.sql',import.meta.url),'utf8'));
  await pool.query(growthCatalogSql());
  await pool.query(refreshChallengeLessonsSql());
  await pool.query(refreshAssessmentCatalogSql());
  await pool.query(await readFile(new URL('../../database/005_exam_integrity.sql',import.meta.url),'utf8'));
  await pool.query(await readFile(new URL('../../database/006_exam_bank.sql', import.meta.url), 'utf8'));
  await pool.query(await readFile(new URL('../../database/007_milestone_coaching.sql', import.meta.url), 'utf8'));
  await pool.query(await readFile(new URL('../../database/008_company_marketplace.sql', import.meta.url), 'utf8'));
  await pool.query(await readFile(new URL('../../database/009_question_results.sql', import.meta.url), 'utf8'));
  console.log("Weeks 1–4 schema, starter catalogue, and exam-bank tables are ready. Existing accounts and results were preserved.");
} catch (error) {
  console.error("Schema setup failed:", error.code || error.message);
  console.error("Create PostgreSQL first and set DATABASE_URL in backend/.env, or run backend/database/weconnect_weeks_1_4.sql in pgAdmin.");
  process.exitCode = 1;
} finally { await pool.end(); }
