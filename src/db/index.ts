import pg from "pg";
import { config } from "../config/index.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.db.url,
  max: 20, // Connection pool max size
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on("error", (err) => {
  console.error("Unexpected error on idle PostgreSQL client", err);
});

export async function query<T extends pg.QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<pg.QueryResult<T>> {
  const start = Date.now();
  const res = await pool.query<T>(text, params);
  const duration = Date.now() - start;
  if (process.env.DEBUG_SQL) {
    console.log("Executed SQL query", { text, duration, rows: res.rowCount });
  }
  return res;
}
