import fs from "node:fs/promises";
import path from "node:path";

export async function ask(question: string): Promise<string> {
  const { createInterface } = await import("node:readline/promises");
  const { stdin, stdout } = await import("node:process");
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

export function parseYesNo(answer: string): boolean {
  const a = answer.trim().toLowerCase();
  if (a === "y" || a === "yes") return true;
  if (a === "n" || a === "no") return false;
  throw new Error(`y 또는 n을 입력하세요 (입력: ${answer})`);
}

export async function readPrd(prdPath: string) {
  const abs = path.resolve(prdPath);
  return { abs, text: await fs.readFile(abs, "utf8") };
}
