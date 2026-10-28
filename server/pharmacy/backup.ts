import { createConnection, type RowDataPacket } from "mysql2/promise";
import { gzipSync } from "node:zlib";

const BACKUP_TABLES = ["users", "categories", "app_state", "medicines", "shifts", "invoices", "invoice_items", "audit_logs", "sessions"] as const;
const SECRET_TABLES = new Set<string>(["sessions"]);

function identifier(name: string): string {
  if (!/^[a-z_]+$/.test(name)) throw new Error("Invalid backup table name");
  return `\`${name}\``;
}

function literal(value: unknown, escape: (value: string) => string): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "boolean") return value ? "1" : "0";
  if (Buffer.isBuffer(value)) return `X'${value.toString("hex")}'`;
  const text = value instanceof Date ? value.toISOString().slice(0, 19).replace("T", " ") : String(value);
  return escape(text);
}

export async function createSqlBackup(): Promise<Buffer> {
  const dsn = process.env.DATABASE_URL;
  if (!dsn) throw new Error("Database configuration is unavailable");
  const connection = await createConnection(dsn);
  try {
    await connection.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await connection.query("START TRANSACTION WITH CONSISTENT SNAPSHOT");
    const statements = [
      "-- M Pharmacy SQL backup; restore into an empty MySQL database.",
      `-- Created: ${new Date().toISOString()}`,
      "SET NAMES utf8mb4;",
      "SET FOREIGN_KEY_CHECKS=0;",
    ];
    for (const table of BACKUP_TABLES) {
      const name = identifier(table);
      const [ddlRows] = await connection.query<RowDataPacket[]>(`SHOW CREATE TABLE ${name}`);
      const ddl = String(ddlRows[0]?.["Create Table"] ?? "");
      if (!ddl) throw new Error(`Missing table definition for ${table}`);
      statements.push(`${ddl};`);
      if (SECRET_TABLES.has(table)) {
        statements.push(`-- ${table} deliberately excluded; active login sessions are not restored.`);
        continue;
      }
      const [rows] = await connection.query<RowDataPacket[]>(`SELECT * FROM ${name}`);
      if (!rows.length) continue;
      const columns = Object.keys(rows[0]).map(column => `\`${column.replace(/`/g, "``")}\``).join(", ");
      for (const row of rows) {
        const values = Object.values(row).map(value => literal(value, item => connection.escape(item)));
        statements.push(`INSERT INTO ${name} (${columns}) VALUES (${values.join(", ")});`);
      }
    }
    statements.push("SET FOREIGN_KEY_CHECKS=1;", "COMMIT;");
    await connection.commit();
    return gzipSync(Buffer.from(`${statements.join("\n")}\n`, "utf8"), { level: 6 });
  } catch (error) {
    await connection.rollback().catch(() => undefined);
    throw error;
  } finally {
    await connection.end();
  }
}
