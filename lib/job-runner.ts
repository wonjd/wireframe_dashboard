import { db } from "./db";
import { docFromAgentResult, GenerationError, startCloudWireframe } from "@/lib/wireframe/generate";
import { getLatestRevision } from "./prd-service";
import { cancelCloudRun, causeMessage, getCloudRun } from "./cursor-cloud";

const JOB_TIMEOUT_MS = 15 * 60 * 1000;

export function shouldStartInServer(): boolean {
  return process.env.GENERATION_MODE !== "worker";
}

export async function isJobCanceled(jobId: string): Promise<boolean> {
  const job = await db.generationJob.findUnique({
    where: { id: jobId },
    select: { status: true },
  });
  return job?.status === "CANCELED";
}

function formatJobError(e: unknown): string {
  if (e instanceof GenerationError) return e.message;
  return causeMessage(e);
}

async function failJob(jobId: string, prdId: string, message: string): Promise<void> {
  console.error("[job] 생성 실패", jobId, message);
  await db.$transaction([
    db.generationJob.update({ where: { id: jobId }, data: { status: "FAILED", error: message } }),
    db.prd.update({ where: { id: prdId }, data: { status: "FAILED" } }),
  ]);
}

/** Cursor Cloud agent만 착수한다. wait 하지 않는다. */
export async function startJob(jobId: string, opts?: { model?: string }): Promise<void> {
  const claimed = await db.generationJob.updateMany({
    where: { id: jobId, status: { in: ["PENDING", "RUNNING"] } },
    data: { status: "RUNNING" },
  });
  if (claimed.count === 0) return;

  const job = await db.generationJob.findUnique({ where: { id: jobId } });
  if (!job) return;
  if (job.cursorRunId) return;

  try {
    const prd = await db.prd.findUnique({ where: { id: job.prdId } });
    if (!prd) throw new GenerationError("PRD가 삭제되었습니다.");

    const revision = await getLatestRevision(prd.id);
    if (!revision) throw new GenerationError("PRD 리비전이 없습니다.");

    const started = await startCloudWireframe({
      sourceText: revision.sourceText,
      model: opts?.model,
    });

    if (await isJobCanceled(jobId)) {
      await cancelCloudRun(started.agentId, started.runId);
      return;
    }

    await db.generationJob.update({
      where: { id: jobId },
      data: {
        cursorAgentId: started.agentId,
        cursorRunId: started.runId,
        model: started.model,
      },
    });
  } catch (e) {
    if (await isJobCanceled(jobId)) return;
    await failJob(jobId, job.prdId, formatJobError(e));
  }
}

/** 상태 폴링이 Cursor run을 수거해 Job을 끝낸다. */
export async function settleJob(jobId: string): Promise<void> {
  const job = await db.generationJob.findUnique({ where: { id: jobId } });
  if (!job || job.status !== "RUNNING") return;
  if (!job.cursorAgentId || !job.cursorRunId) return;

  if (Date.now() - job.createdAt.getTime() > JOB_TIMEOUT_MS) {
    await failJob(jobId, job.prdId, "생성 시간이 초과되었습니다.");
    return;
  }

  let run;
  try {
    run = await getCloudRun(job.cursorAgentId, job.cursorRunId);
  } catch (e) {
    console.error("[job] Cursor 폴링 실패", jobId, formatJobError(e));
    return;
  }

  if (run.status === "CREATING" || run.status === "RUNNING") return;

  if (await isJobCanceled(jobId)) return;

  if (run.status !== "FINISHED") {
    await failJob(jobId, job.prdId, run.error || ("Cursor run " + run.status));
    return;
  }

  const revision = await getLatestRevision(job.prdId);
  if (!revision) {
    await failJob(jobId, job.prdId, "PRD 리비전이 없습니다.");
    return;
  }

  const { doc, model } = docFromAgentResult(run.result, job.model || "composer-2.5");
  const last = await db.wireframe.findFirst({
    where: { prdId: job.prdId },
    orderBy: { version: "desc" },
    select: { version: true },
  });

  const wireframe = await db.wireframe.create({
    data: {
      prdId: job.prdId,
      version: (last?.version ?? 0) + 1,
      docJson: JSON.stringify(doc),
      prdRevisionId: revision.id,
      model,
    },
  });

  const claimed = await db.generationJob.updateMany({
    where: { id: jobId, status: "RUNNING" },
    data: { status: "DONE", wireframeId: wireframe.id, error: null },
  });
  if (claimed.count === 0) {
    await db.wireframe.delete({ where: { id: wireframe.id } });
    return;
  }

  await db.prd.update({ where: { id: job.prdId }, data: { status: "GENERATED" } });
}

export async function startJobIfServer(jobId: string, opts?: { model?: string }): Promise<void> {
  if (!shouldStartInServer()) return;
  await startJob(jobId, opts);
}
