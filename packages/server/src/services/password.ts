import { randomInt } from "node:crypto";
import bcrypt from "bcryptjs";

// Same "no look-alike characters" alphabet as decom/KPI (no 0/O, 1/I/l), but 10 characters from a
// CSPRNG instead of 4 from Math.random — this app is reachable from the internet via DuckDNS.
const CHARSET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";

export function generatePassword(length = 10): string {
  let out = "";
  for (let i = 0; i < length; i++) out += CHARSET[randomInt(CHARSET.length)];
  return out;
}

export const hashPassword = (password: string) => bcrypt.hashSync(password, 10);

export function verifyPassword(password: string, hash: string): boolean {
  try {
    return bcrypt.compareSync(password, hash);
  } catch {
    return false; // e.g. a restored account's placeholder hash
  }
}
