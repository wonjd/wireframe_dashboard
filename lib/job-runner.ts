import { db } from "./db";
import { generateWireframe, GenerationError } from "./wireframe/generate";
import { getLatestRevision } from "./prd-service";

/**
 * 생성 Job 실행 — §4 요청 흐름.
 *
 * Job 레코드를 먼저 만들고(호출자), 여기서 RUNNING → DONE/FAILED로 옮긴다.
 * 실패해도 기존 Wireframe 버전은 손대지 않는다 — 생성 실패가 이미 보고 있던
 * 화면을 훼손하지 않는 것이 버전 테이블을 분리한 이유다 (§9).
 */
export async function runJob(jobId: string, opts?: { model?: string }): Promise<void> {
  const job = await db.generationJob.findUnique({ where: { id: jobId } });
  if (!job) return;
  if (job.status === "DONE" || job.status === "FAILED") return;

  await db.generationJob.update({ where: { id: jobId }, data: { status: "RUNNING" } });

  try {
    const prd = await db.prd.findUnique({ where: { id: job.prdId } });
    if (!prd) throw new GenerationError("PRD가 삭제되었습니다.");

    const revision = await getLatestRevision(prd.id);
    if (!revision) throw new GenerationError("PRD 리비전이 없습니다.");

    // T2(본문 수정에 의한 자동 재생성)일 때만 직전 IR을 앵커로 넘긴다 — §6.5.
    let previousDocJson: string | undefined;
    if (job.trigger === "T2") {
      const prev = await db.wireframe.findFirst({
        where: { prdId: prd.id },
        orderBy: { version: "desc" },
        select: { docJson: true },
      });
      previousDocJson = prev?.docJson;
    }

    const { doc, model } = await generateWireframe({
      sourceText: revision.sourceText,
      model: opts?.model,
      previousDocJson,
    });

    const last = await db.wireframe.findFirst({
      where: { prdId: prd.id },
      orderBy: { version: "desc" },
      select: { version: true },
    });

    const wireframe = await db.wireframe.create({
      data: {
        prdId: prd.id,
        version: (last?.version ?? 0) + 1,
        docJson: JSON.stringify(doc),
        prdRevisionId: revision.id,
        model,
      },
    });

    await db.$transaction([
      db.generationJob.update({
        where: { id: jobId },
        data: { status: "DONE", wireframeId: wireframe.id, error: null },
      }),
      db.prd.update({ where: { id: prd.id }, data: { status: "GENERATED" } }),
    ]);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[job] 생성 실패", jobId, message);
    await db.$transaction([
      db.generationJob.update({ where: { id: jobId }, data: { status: "FAILED", error: message } }),
      db.prd.update({ where: { id: job.prdId }, data: { status: "FAILED" } }),
    ]);
  }
}

/**
 * Job을 응답과 분리해 실행한다 — §13.5.
 *
 * 클라이언트는 202를 받고 status API를 폴링하므로 긴 요청을 물고 있지 않는다.
 * 서버리스에서는 함수가 응답 후 종료될 수 있어 v1은 "함수 1회 실행 안에 완료"를
 * 전제로 한다. 초대형 PRD가 문제되면 큐/워커 분리를 검토한다 (§17.2).
 */
export function runJobDetached(jobId: string, opts?: { model?: string }): void {
  void runJob(jobId, opts).catch((e) => console.error("[job] detached 실패", jobId, e));
}
