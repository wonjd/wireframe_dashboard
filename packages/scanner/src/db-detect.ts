import fs from "node:fs/promises";
import path from "node:path";
import { dbSpecSchema, type DbOrm, type DbProvider, type DbSpec } from "@wireframe-studio/core";

const PRISMA_CANDIDATES = [
  "prisma/schema.prisma",
  "packages/db/prisma/schema.prisma",
  "apps/api/prisma/schema.prisma",
];

const DRIZZLE_CANDIDATES = ["drizzle.config.ts", "drizzle.config.js", "src/db/schema.ts"];

const ENV_CANDIDATES = [".env.example", ".env.local.example", ".env.sample", "env.example"];

async function exists(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function parsePrismaProvider(text: string): DbProvider {
  const m = text.match(/provider\s*=\s*"([^"]+)"/);
  if (!m) return "unknown";
  const p = m[1]!.toLowerCase();
  if (p.includes("sqlite")) return "sqlite";
  if (p.includes("postgres")) return "postgresql";
  if (p.includes("mysql")) return "mysql";
  if (p.includes("mongo")) return "mongodb";
  return "unknown";
}

function parsePrismaModels(text: string): string[] {
  const models: string[] = [];
  for (const m of text.matchAll(/^model\s+(\w+)\s*\{/gm)) models.push(m[1]!);
  return models.slice(0, 30);
}

async function findFirst(dir: string, candidates: string[]) {
  for (const rel of candidates) {
    const full = path.join(dir, rel);
    if (await exists(full)) return full;
  }
  return null;
}

/** EXISTING 모드 — 대상 repo DB 스키마·ORM 감지 */
export async function detectDatabase(repoPath: string): Promise<DbSpec> {
  const abs = path.resolve(repoPath);
  const envFiles: string[] = [];

  for (const rel of ENV_CANDIDATES) {
    if (await exists(path.join(abs, rel))) envFiles.push(rel);
  }

  const prismaPath = await findFirst(abs, PRISMA_CANDIDATES);
  if (prismaPath) {
    const text = await fs.readFile(prismaPath, "utf8");
    return dbSpecSchema.parse({
      detected: true,
      orm: "prisma" satisfies DbOrm,
      provider: parsePrismaProvider(text),
      schemaPath: path.relative(abs, prismaPath),
      models: parsePrismaModels(text),
      envFiles,
    });
  }

  const drizzlePath = await findFirst(abs, DRIZZLE_CANDIDATES);
  if (drizzlePath) {
    return dbSpecSchema.parse({
      detected: true,
      orm: "drizzle",
      provider: "unknown",
      schemaPath: path.relative(abs, drizzlePath),
      envFiles,
    });
  }

  try {
    const pkg = JSON.parse(await fs.readFile(path.join(abs, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    if (all.typeorm) {
      return dbSpecSchema.parse({ detected: true, orm: "typeorm", provider: "unknown", envFiles });
    }
  } catch {
    /* no package.json */
  }

  return dbSpecSchema.parse({ detected: false, envFiles });
}
