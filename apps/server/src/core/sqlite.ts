import { createRequire } from "node:module";

type SqliteOptions = { readonly?: boolean; readOnly?: boolean };

export type SqliteStatement = {
  run: (...args: unknown[]) => unknown;
  get: (...args: unknown[]) => unknown;
  all: (...args: unknown[]) => unknown[];
};

export type SqliteDatabase = {
  exec: (sql: string) => unknown;
  prepare: (sql: string) => SqliteStatement;
  query: (sql: string) => SqliteStatement;
  transaction: <Args extends unknown[], Result>(fn: (...args: Args) => Result) => (...args: Args) => Result;
  close: () => void;
};

const require = createRequire(import.meta.url);

function loadNativeSqlite(): new (path: string, options?: SqliteOptions) => SqliteDatabase {
  try {
    const bunSqlite = require("bun:sqlite") as { Database: new (path: string, options?: SqliteOptions) => SqliteDatabase };
    return bunSqlite.Database;
  } catch {
    const nodeSqlite = require("node:sqlite") as { DatabaseSync: new (path: string, options?: SqliteOptions) => Omit<SqliteDatabase, "query" | "transaction"> };
    return class NodeSqliteDatabase implements SqliteDatabase {
      readonly #db: Omit<SqliteDatabase, "query" | "transaction">;

      constructor(path: string, options?: SqliteOptions) {
        this.#db = new nodeSqlite.DatabaseSync(path, { readOnly: options?.readonly ?? options?.readOnly });
      }

      exec(sql: string) {
        return this.#db.exec(sql);
      }

      prepare(sql: string) {
        return this.#db.prepare(sql);
      }

      query(sql: string) {
        return this.prepare(sql);
      }

      transaction<Args extends unknown[], Result>(fn: (...args: Args) => Result) {
        return (...args: Args) => {
          this.exec("BEGIN");
          try {
            const result = fn(...args);
            this.exec("COMMIT");
            return result;
          } catch (error) {
            try {
              this.exec("ROLLBACK");
            } catch {
              // Preserve the original transaction error.
            }
            throw error;
          }
        };
      }

      close() {
        return this.#db.close();
      }
    };
  }
}

export const Database = loadNativeSqlite();
