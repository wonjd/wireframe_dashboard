import { fileURLToPath } from "node:url";
import path from "node:path";
import { runDetect, runIntegrate } from "./commands.js";
import { printUsage } from "./usage.js";
import { runWorkflowFromFlags } from "./start.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const [cmd, ...rest] = process.argv.slice(2);
if (!cmd || cmd === "start") runWorkflowFromFlags(rest, path.join(root, "wireFrame")).catch((e) => { console.error(e); process.exit(1); });
else if (cmd === "generate") runWorkflowFromFlags(rest, path.join(root, "wireFrame")).catch((e) => { console.error(e); process.exit(1); });
else if (cmd === "detect") runDetect(rest).catch((e) => { console.error(e); process.exit(1); });
else if (cmd === "integrate") runIntegrate(rest, root).catch((e) => { console.error(e); process.exit(1); });
else printUsage();
