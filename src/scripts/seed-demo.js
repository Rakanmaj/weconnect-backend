import { getConfig } from "../config.js";
import { createPool, transaction } from "../db.js";
import { hashPassword } from "../passwords.js";

const config = getConfig();
if (config.production || process.env.ALLOW_DEMO_SEED !== "true") {
  console.error("Demo seed is disabled. For a local presentation only, set ALLOW_DEMO_SEED=true in .env.");
  process.exit(1);
}
const password = process.env.DEMO_PASSWORD || "WeConnect2026!";
if (password.length < 8 || password.length > 128) throw new Error("DEMO_PASSWORD must contain 8 to 128 characters.");
const pool = createPool(config.databaseUrl);
try {
  for (const account of [
    { role: "developer", email: "ahmad.ali@example.com", first: "Ahmad", last: "Ali" },
    { role: "company", email: "sarah@techflow.example.com", first: "Sarah", last: "Al-Masri" },
    { role: "admin", email: "admin@weconnect.io", first: "Admin", last: "User" },
  ]) {
    const hash = await hashPassword(password);
    const created = await transaction(pool, async client => {
      const { rows } = await client.query(
        `INSERT INTO public.users (role, email, password_hash, first_name, last_name)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING RETURNING id`,
        [account.role, account.email, hash, account.first, account.last],
      );
      if (!rows[0]) return false;
      if (account.role === "developer") {
        await client.query(`INSERT INTO public.developer_profiles (user_id, preferred_position, location, github_url)
          VALUES ($1, 'Full-Stack Developer', 'Amman, Jordan', 'https://github.com/ahmad-ali')`, [rows[0].id]);
      }
      if (account.role === "company") {
        await client.query(`INSERT INTO public.company_profiles
          (user_id, company_name, website, industry, company_size, location, contact_name, contact_title, about)
          VALUES ($1, 'TechFlow Solutions', 'https://techflow.example.com', 'Software & Technology', '50-200',
          'Amman, Jordan', 'Sarah Al-Masri', 'Head of Engineering', 'Customer-support software and product delivery.')`, [rows[0].id]);
      }
      return true;
    });
    console.log(`${created ? "Created" : "Already exists; unchanged"}: ${account.email}`);
  }
  console.log("Presentation shortcuts use WeConnect2026! unless you change the seeded password.");
} catch (error) {
  console.error("Demo seed failed:", error.code || error.message);
  process.exitCode = 1;
} finally { await pool.end(); }
