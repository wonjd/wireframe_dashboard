import fs from "node:fs";
import path from "node:path";

/** Load .env / .env.local into process.env (does not override existing). */
export function loadEnvFiles(root: string): void {
  for (const name of [".env.local", ".env"]) {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      // Prefer .env when key is unset or empty (Windows often has blank env slots).
      if (!process.env[key]) process.env[key] = value;
    }
  }
}

export function requireOpenAiKey(): string {
  const key = (process.env.OPENAI_API_KEY || "").trim();
  if (!key) {
    throw new Error(
      "OPENAI_API_KEY가 없습니다. 레포 루트 .env에 OPENAI_API_KEY=sk-... 를 넣고 npm run dev 를 다시 켜세요.",
    );
  }
  return key;
}

export function openAiModel(): string {
  return (process.env.OPENAI_MODEL || "gpt-4.1-mini").trim() || "gpt-4.1-mini";
}
