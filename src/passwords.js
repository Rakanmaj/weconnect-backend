import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const derive = promisify(scrypt);
const OPTIONS = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };

export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = await derive(password, salt, 64, OPTIONS);
  return `scrypt$${OPTIONS.N}$${OPTIONS.r}$${OPTIONS.p}$${salt}$${hash.toString("hex")}`;
}

export async function verifyPassword(password, encoded) {
  const [algorithm, cost, blockSize, parallelism, salt, digest, extra] = String(encoded).split("$");
  if (algorithm !== "scrypt" || cost !== "131072" || blockSize !== "8" || parallelism !== "1" || extra ||
      !/^[a-f0-9]{32}$/.test(salt || "") || !/^[a-f0-9]{128}$/.test(digest || "")) return false;
  const actual = await derive(password, salt, 64, OPTIONS);
  return timingSafeEqual(actual, Buffer.from(digest, "hex"));
}

// Failed lookups still perform the password derivation to avoid a fast missing-user path.
export const DUMMY_HASH = `scrypt$131072$8$1$${"0".repeat(32)}$${"0".repeat(128)}`;
