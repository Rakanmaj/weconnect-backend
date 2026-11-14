import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createApp } from "./app.js";
import { getConfig } from "./config.js";
import { createPool } from "./db.js";

const config = getConfig();
const pool = createPool(config.databaseUrl);
const app = createApp({ pool, config });
const serveFrontend = process.argv.includes("--serve");
const port = Number(process.env.PORT || (serveFrontend ? 3000 : config.apiPort));

if (serveFrontend) {
  const dist = fileURLToPath(new URL("../../frontend/dist", import.meta.url));
  if (!existsSync(path.join(dist, "index.html"))) {
    console.error("Build the frontend first with npm run build.");
    process.exit(1);
  }
  app.use(express.static(dist));
  app.get("/{*path}", (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

const server = app.listen(port, "127.0.0.1", () => {
  console.log(`WeConnect ${serveFrontend ? "app" : "API"}: http://localhost:${port}`);
  if (!config.databaseUrl) console.log("Set DATABASE_URL in backend/.env after creating PostgreSQL and running backend/database/weconnect_weeks_1_4.sql.");
});
server.on("error", error => {
  console.error(error.code === "EADDRINUSE" ? `Port ${port} is already in use. Stop the existing server before restarting.` : error.message);
  process.exitCode = 1;
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(async () => { await pool.end(); process.exit(0); }));
}
