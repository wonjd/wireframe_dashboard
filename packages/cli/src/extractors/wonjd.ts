import { spawn } from "node:child_process";
import type { ResolvedProject } from "../lib/config.js";
import { resolveSourcePath } from "../lib/config.js";

type QueryResult = {
  columns: string[];
  rows: unknown[][];
  row_count: number;
  error?: string;
  error_detail?: string;
};

export async function runWonjdQuery(project: ResolvedProject, sql: string): Promise<QueryResult> {
  const wonjd = project.sources.wonjd;
  if (wonjd.type !== "cli") {
    throw new Error("wonjd http mode is not implemented yet");
  }

  const cwd = wonjd.cwd ? resolveSourcePath(wonjd.cwd) : process.cwd();
  const command = wonjd.command ?? "uv";
  const baseArgs = wonjd.args ?? ["run", "db/query.py", "--json"];
  const sqlOneLine = sql.replace(/\s+/g, " ").trim();
  const args = [...baseArgs, "--sql", sqlOneLine];

  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      windowsHide: true,
      env: process.env,
    });

    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => {
      out += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      err += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(err || out || `${command} exited with ${code}`));
        return;
      }
      resolve(out);
    });
  });

  const parsed = JSON.parse(stdout) as QueryResult;
  if (parsed.error) {
    throw new Error(`${parsed.error}: ${parsed.error_detail ?? "query failed"}`);
  }
  return parsed;
}

export function quoteSql(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
