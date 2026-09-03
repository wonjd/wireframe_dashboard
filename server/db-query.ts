import fs from "node:fs";
import net from "node:net";
import mysql from "mysql2/promise";
import { Client, type ConnectConfig } from "ssh2";
import { dbEnvStatus, readDbEnv, type DbEnvConfig } from "./db-env.js";

export type QueryResult = {
  ok: true;
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  truncated: boolean;
  sql: string;
  ms: number;
};

const FORBIDDEN =
  /\b(INSERT|UPDATE|DELETE|REPLACE|UPSERT|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|CALL|EXECUTE|LOAD\s+DATA|INTO\s+OUTFILE|INTO\s+DUMPFILE|SET\s+\w+\s*=|LOCK\s+TABLES|UNLOCK|RENAME|HANDLER|DO\s+)\b/i;

/** Only read-only statements. */
export function assertSelectOnly(sql: string): string {
  const cleaned = sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/#[^\n]*/g, " ")
    .trim();
  if (!cleaned) throw new Error("SQL이 비어 있습니다.");
  if (cleaned.includes(";")) {
    const parts = cleaned.split(";").map((p) => p.trim()).filter(Boolean);
    if (parts.length > 1) throw new Error("한 번에 하나의 SELECT만 허용합니다.");
  }
  const one = cleaned.replace(/;+\s*$/, "").trim();
  if (FORBIDDEN.test(one)) {
    throw new Error("SELECT / SHOW / DESCRIBE / EXPLAIN / WITH 만 허용합니다. 데이터 수정은 불가합니다.");
  }
  if (!/^\s*(SELECT|WITH|SHOW|DESCRIBE|DESC|EXPLAIN)\b/i.test(one)) {
    throw new Error("SELECT / SHOW / DESCRIBE / EXPLAIN / WITH 로 시작해야 합니다.");
  }
  return one;
}

function withLimit(sql: string, maxRows: number): { sql: string; forcedLimit: boolean } {
  if (/^\s*(SHOW|DESCRIBE|DESC|EXPLAIN)\b/i.test(sql)) {
    return { sql, forcedLimit: false };
  }
  if (/\bLIMIT\s+\d+/i.test(sql)) {
    return { sql, forcedLimit: false };
  }
  return { sql: `${sql}\nLIMIT ${maxRows}`, forcedLimit: true };
}

type Tunnel = {
  server: net.Server;
  localPort: number;
  close: () => Promise<void>;
};

async function openSshTunnel(cfg: DbEnvConfig): Promise<Tunnel> {
  const ssh = new Client();
  const connectCfg: ConnectConfig = {
    host: cfg.ssh.host,
    port: cfg.ssh.port,
    username: cfg.ssh.user,
    readyTimeout: 20_000,
  };
  if (cfg.ssh.keyPath) {
    connectCfg.privateKey = fs.readFileSync(cfg.ssh.keyPath);
    if (cfg.ssh.keyPassphrase) connectCfg.passphrase = cfg.ssh.keyPassphrase;
  } else if (cfg.ssh.password) {
    connectCfg.password = cfg.ssh.password;
  } else {
    throw new Error("SSH_KEY_PATH 또는 SSH_PASSWORD가 필요합니다.");
  }

  await new Promise<void>((resolve, reject) => {
    ssh
      .on("ready", () => resolve())
      .on("error", reject)
      .connect(connectCfg);
  });

  const server = net.createServer((socket) => {
    ssh.forwardOut(
      socket.remoteAddress || "127.0.0.1",
      socket.remotePort || 0,
      cfg.db.remoteHost,
      cfg.db.remotePort,
      (err, stream) => {
        if (err) {
          socket.destroy();
          return;
        }
        socket.pipe(stream).pipe(socket);
      },
    );
  });

  const localPort = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("tunnel bind failed"));
        return;
      }
      resolve(addr.port);
    });
  });

  return {
    server,
    localPort,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      ssh.end();
    },
  };
}

export async function runSelectQuery(sqlInput: string): Promise<QueryResult> {
  const status = dbEnvStatus();
  if (!status.ok) {
    throw new Error(`DB env 부족: ${status.missing.join(", ")}`);
  }
  const cfg = readDbEnv();
  const safe = assertSelectOnly(sqlInput);
  const { sql, forcedLimit } = withLimit(safe, cfg.db.maxRows);

  let tunnel: Tunnel | null = null;
  const started = Date.now();
  try {
    let host = cfg.db.host;
    let port = cfg.db.port;
    if (cfg.useSshTunnel) {
      tunnel = await openSshTunnel(cfg);
      host = "127.0.0.1";
      port = tunnel.localPort;
    }

    const conn = await mysql.createConnection({
      host,
      port,
      user: cfg.db.user,
      password: cfg.db.password,
      database: cfg.db.name,
      connectTimeout: cfg.db.queryTimeoutSec * 1000,
      multipleStatements: false,
    });

    try {
      const [rows, fields] = await conn.query({ sql, timeout: cfg.db.queryTimeoutSec * 1000 });
      const columns = Array.isArray(fields)
        ? fields.map((f) => ("name" in f ? String(f.name) : String(f)))
        : [];
      const list = Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
      const matrix = list.map((row) => columns.map((col) => row[col] ?? null));
      return {
        ok: true,
        columns,
        rows: matrix,
        rowCount: matrix.length,
        truncated: forcedLimit && matrix.length >= cfg.db.maxRows,
        sql,
        ms: Date.now() - started,
      };
    } finally {
      await conn.end();
    }
  } finally {
    if (tunnel) await tunnel.close();
  }
}

export async function listTables(limit = 40): Promise<QueryResult> {
  return runSelectQuery(
    `SELECT TABLE_NAME, TABLE_ROWS, TABLE_COMMENT
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
     ORDER BY TABLE_ROWS DESC
     LIMIT ${Math.min(Math.max(limit, 1), 100)}`,
  );
}
