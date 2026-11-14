import { z } from "zod";
import { getConfig } from "../config.js";
import { createPool } from "../db.js";
import { hashPassword } from "../passwords.js";

const config = getConfig();
const input = z.object({
  email: z.string().trim().toLowerCase().max(254).email(),
  password: z.string().min(8).max(128),
  name: z.string().trim().min(1).max(100),
}).safeParse({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD, name: process.env.ADMIN_NAME || "Admin" });
if (!input.success) {
  console.error("Set ADMIN_EMAIL and ADMIN_PASSWORD (8-128 characters) in your local .env. ADMIN_NAME is optional.");
  process.exit(1);
}
const pool = createPool(config.databaseUrl);
try {
  const hash = await hashPassword(input.data.password);
  await pool.query(`INSERT INTO public.users (role, email, password_hash, first_name, last_name)
    VALUES ('admin', $1, $2, $3, '')`, [input.data.email, hash, input.data.name]);
  console.log("Administrator account created. Sign in at /admin/login.");
} catch (error) {
  console.error(error.code === "23505" ? "That email already has an account; it was not changed or promoted." : `Admin creation failed: ${error.code || error.name}`);
  process.exitCode = 1;
} finally { await pool.end(); }
