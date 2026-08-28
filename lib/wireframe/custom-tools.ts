import type { SDKJsonValue } from "@cursor/sdk";
import { EMIT_TOOL } from "./tool-schema";

export function createCustomTools(captured: { value?: unknown }) {
  return {
    emit_wireframe: {
      description: EMIT_TOOL.description,
      inputSchema: EMIT_TOOL.input_schema as Record<string, SDKJsonValue>,
      execute: (args: Record<string, SDKJsonValue>) => {
        captured.value = args;
        return args;
      },
    },
  };
}
