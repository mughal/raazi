import Database from "better-sqlite3";
import { mkdirSync, existsSync, copyFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
const database = resolve(process.env.DATABASE ?? "data/raazi.db");
if (!existsSync(database)) throw new Error("No existing database to back up.");
const directory = join(
  dirname(database),
  "backups",
  new Date().toISOString().replace(/[:.]/g, "-"),
);
mkdirSync(directory, { recursive: true });
const db = new Database(database, { readonly: true, fileMustExist: true });
try {
  await db.backup(join(directory, "raazi.db"));
  const key = join(dirname(database), "encryption.key");
  if (existsSync(key)) copyFileSync(key, join(directory, "encryption.key"));
  console.log("Workspace backup saved to " + directory);
} finally {
  db.close();
}
