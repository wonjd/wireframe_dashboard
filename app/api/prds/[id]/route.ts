import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { ApiError, apiError, handle } from "@/lib/api-error";
import { requireUser } from "@/lib/session";
import { createJob, getLatestRevision, updatePrd } from "@/lib/prd-service";
import { runJobDetached } from "@/lib/job-runner";
import { MAX_SOURCE_TEXT, MAX_UPLOAD_BYTES } from "@/lib/constants";
import { toPrdDto } from "@/lib/serializers";

type Ctx = { params: Promise<{ id: string }> };

const patchBody = z.object({
  title: z.string().min(1).max(200).optional(),
  sourceText: z.string().min(1).max(MAX_SOURCE_TEXT).optional(),
});

export async function GET(_req: NextRequest, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    const prd = await db.prd.findUnique({ where: { id } });
    if (!prd) throw new ApiError("NOT_FOUND", "PRD를 찾을 수 없습니다.");

    const [revision, activeJob] = await Promise.all([
      getLatestRevision(id),
      db.generationJob.findFirst({
        where: { prdId: id, status: { in: ["PENDING", "RUNNING"] } },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    return NextResponse.json(
      toPrdDto(prd, { jobId: activeJob?.id ?? null, currentRevision: revision?.revision })
    );
  });
}

/**
 * PRD 수정. sourceText가 실제로 바뀐 경우에만 리비전이 쌓이고 재생성이 걸린다 (T2, §6.2).
 * title만 바꾸면 jobId는 null이고 생성은 돌지 않는다 — 화면과 무관한 변경에 토큰을 쓰지 않는다.
 */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    const user = await requireUser();
    const contentType = req.headers.get("content-type") ?? "";

    let title: string | undefined;
    let sourceText: string | undefined;
    let source: "UPLOAD" | "EDIT" = "EDIT";

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) throw new ApiError("VALIDATION_ERROR", "파일이 필요합니다.");
      if (file.size > MAX_UPLOAD_BYTES) throw new ApiError("VALIDATION_ERROR", "파일이 너무 큽니다 (최대 1MB).");
      const text = await file.text();
      if (!text.trim()) throw new ApiError("VALIDATION_ERROR", "파일이 비어 있습니다.");
      if (text.length > MAX_SOURCE_TEXT) {
        throw new ApiError("VALIDATION_ERROR", `PRD가 너무 깁니다 (최대 ${MAX_SOURCE_TEXT}자).`);
      }
      sourceText = text;
      const formTitle = form.get("title");
      if (typeof formTitle === "string" && formTitle.trim()) title = formTitle.trim();
      source = "UPLOAD";
    } else {
      const parsed = patchBody.safeParse(await req.json().catch(() => null));
      if (!parsed.success) {
        return apiError("VALIDATION_ERROR", parsed.error.issues.map((i) => i.message).join(", "));
      }
      if (parsed.data.title === undefined && parsed.data.sourceText === undefined) {
        throw new ApiError("VALIDATION_ERROR", "변경할 내용이 없습니다.");
      }
      title = parsed.data.title;
      sourceText = parsed.data.sourceText;
    }

    const { prd, revision } = await updatePrd({
      prdId: id,
      title,
      sourceText,
      source,
      authorId: user.id,
    });

    // 본문이 바뀐 경우에만 자동 재생성 (§6.2 T2)
    let jobId: string | null = null;
    if (revision) {
      const { job } = await createJob({ prdId: prd.id, trigger: "T2", userId: user.id });
      jobId = job.id;
      runJobDetached(job.id);
    }

    const latest = revision ?? (await getLatestRevision(prd.id));
    return NextResponse.json(
      toPrdDto(revision ? { ...prd, status: "GENERATING" } : prd, {
        jobId,
        currentRevision: latest?.revision,
      })
    );
  });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    const prd = await db.prd.findUnique({ where: { id } });
    if (!prd) throw new ApiError("NOT_FOUND", "PRD를 찾을 수 없습니다.");
    await db.prd.delete({ where: { id } });
    return new NextResponse(null, { status: 204 });
  });
}
