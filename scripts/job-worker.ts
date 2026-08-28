import { db } from "../lib/db";
import { startJob, settleJob } from "../lib/job-runner";

const INTERVAL_MS = 2000;

async function tick(): Promise<void> {
  const pending = await db.generationJob.findFirst({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
  });
  if (pending) {
    await startJob(pending.id);
    return;
  }

  const running = await db.generationJob.findFirst({
    where: { status: "RUNNING", NOT: { cursorRunId: null } },
    orderBy: { createdAt: "asc" },
  });
  if (running) await settleJob(running.id);
}

async function loop(): Promise<void> {
  console.info("[worker] polling generation jobs every " + INTERVAL_MS + "ms");
  for (;;) {
    try {
      await tick();
    } catch (e) {
      console.error("[worker]", e);
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}

void loop();
