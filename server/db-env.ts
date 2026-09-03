/**
 * Live DB access — credentials ONLY from process.env.
 * Never read host/user/password from wireframe.config.json, UI, or chat.
 * Account must be SELECT-only.
 */

export type DbEnvConfig = {
  useSshTunnel: boolean;
  ssh: {
    host: string;
    port: number;
    user: string;
    password?: string;
    keyPath?: string;
    keyPassphrase?: string;
    localBindHost: string;
    localBindPort: number;
  };
  db: {
    host: string;
    port: number;
    remoteHost: string;
    remotePort: number;
    name: string;
    user: string;
    password: string;
    queryTimeoutSec: number;
    maxRows: number;
  };
};

function env(name: string, fallback = ""): string {
  return (process.env[name] ?? fallback).trim();
}

function envInt(name: string, fallback: number): number {
  const raw = env(name);
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function readDbEnv(): DbEnvConfig {
  // Aliases: SSH_ID=user@host , DB_ID=user
  const sshId = env("SSH_ID");
  let sshUser = env("SSH_USER");
  let sshHost = env("SSH_HOST");
  if (sshId.includes("@")) {
    const at = sshId.lastIndexOf("@");
    if (!sshUser) sshUser = sshId.slice(0, at);
    if (!sshHost) sshHost = sshId.slice(at + 1);
  }

  return {
    useSshTunnel: /^(1|true|yes)$/i.test(env("USE_SSH_TUNNEL", "true")),
    ssh: {
      host: sshHost,
      port: envInt("SSH_PORT", 22),
      user: sshUser,
      password: env("SSH_PASSWORD") || undefined,
      keyPath: env("SSH_KEY_PATH") || undefined,
      keyPassphrase: env("SSH_KEY_PASSPHRASE") || undefined,
      localBindHost: env("SSH_LOCAL_BIND_HOST", "127.0.0.1"),
      localBindPort: envInt("SSH_LOCAL_BIND_PORT", 13306),
    },
    db: {
      host: env("DB_HOST", "127.0.0.1"),
      port: envInt("DB_PORT", 3306),
      remoteHost: env("DB_REMOTE_HOST", "127.0.0.1"),
      remotePort: envInt("DB_REMOTE_PORT", 3306),
      name: env("DB_NAME"),
      user: env("DB_USER") || env("DB_ID"),
      password: env("DB_PASSWORD"),
      queryTimeoutSec: envInt("DB_QUERY_TIMEOUT_SEC", 30),
      maxRows: envInt("DB_MAX_ROWS", 1000),
    },
  };
}

export type DbEnvStatus = {
  ok: boolean;
  source: "env";
  selectOnly: true;
  missing: string[];
  useSshTunnel: boolean;
  hasSshHost: boolean;
  hasDbUser: boolean;
  hasDbName: boolean;
};

/** Report whether required env vars are present — never echo secrets. */
export function dbEnvStatus(): DbEnvStatus {
  const cfg = readDbEnv();
  const missing: string[] = [];
  if (!cfg.db.name) missing.push("DB_NAME");
  if (!cfg.db.user) missing.push("DB_USER");
  if (!cfg.db.password) missing.push("DB_PASSWORD");
  if (cfg.useSshTunnel) {
    if (!cfg.ssh.host) missing.push("SSH_HOST");
    if (!cfg.ssh.user) missing.push("SSH_USER");
    if (!cfg.ssh.password && !cfg.ssh.keyPath) missing.push("SSH_PASSWORD|SSH_KEY_PATH");
  }
  return {
    ok: missing.length === 0,
    source: "env",
    selectOnly: true,
    missing,
    useSshTunnel: cfg.useSshTunnel,
    hasSshHost: Boolean(cfg.ssh.host),
    hasDbUser: Boolean(cfg.db.user),
    hasDbName: Boolean(cfg.db.name),
  };
}
