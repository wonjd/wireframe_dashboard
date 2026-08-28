import { GenerationError } from "./generate-errors";

export function extractJsonFromText(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) throw new GenerationError("Model response is empty.");

  try {
    return JSON.parse(trimmed);
  } catch {
    // continue
  }

  const fenceStart = trimmed.indexOf("```");
  if (fenceStart !== -1) {
    const afterFence = trimmed.indexOf("\n", fenceStart);
    const fenceEnd = trimmed.indexOf("```", afterFence + 1);
    if (afterFence !== -1 && fenceEnd !== -1) {
      try {
        return JSON.parse(trimmed.slice(afterFence + 1, fenceEnd).trim());
      } catch {
        // continue
      }
    }
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      // continue
    }
  }

  throw new GenerationError("Could not find JSON in model response.");
}
