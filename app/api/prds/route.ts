import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { ApiError, apiError, handle } from "@/lib/api-error";
import { requireUser } from "@/lib/session";
import { createPrd, createJob } from "@/lib/prd-service";
import { runJobDetached } from "@/lib/job-runner";
import { MAX_SOURCE_TEXT, MAX_UPLOAD_BYTES } from "@/lib/constants";
import { toPrdDto, toPrdListItem } from "@/lib/serializers";

const jsonBody = z.object({
  title: z.string().min(1).max(200).optional(),
  sourceText: z.string().min(1).max(MAX_SOURCE_TEXT),
});

/** 파일명 또는 문서 첫 `# 헤딩`에서 제목을 뽑는다 — §10.2 */
function deriveTitle(sourceText: string, fileName?: string): string {
  const heading = sourceText.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading.slice(0, 200);
  if (fileName) return fileName.replace(/\.(md|markdown|txt)$/i, "").slice(0, 200);
  return "제목 없는 PRD";
}

export async function GET() {
  return handle(async () => {
    const prds = await db.prd.findMany({ orderBy: { updatedAt: "desc" } });

    const items = await Promise.all(
      prds.map(async (p) => {
        const [latest, lastRevision] = await Promise.all([
          db.wireframe.findFirst({
            where: { prdId: p.id },
            orderBy: { version: "desc" },
            select: { version: true },
          }),
          db.prdRevision.findFirst({
            where: { prdId: p.id },
            orderBy: { revision: "desc" },
            include: { author: { select: { id: true, name: true, email: true } } },
          }),
        ]);
        return toPrdListItem(p, {
          latestWireframeVersion: latest?.version ?? null,
          lastEditor: lastRevision?.author ?? null,
        });
      })
    );

    return NextResponse.json({ items });
  });
}

/**
 * PRD 등록. multipart(prd.md 업로드)와 JSON 텍스트를 모두 받는다.
 * 등록 = 생성이므로 성공 즉시 생성 Job이 시작되고 jobId가 함께 나간다 (T1, §6.2).
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const contentType = req.headers.get("content-type") ?? "";

    let title: string;
    let sourceText: string;
    let source: "UPLOAD" | "EDIT";

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        throw new ApiError("VALIDATION_ERROR", "prd.md 파일이 필요합니다.");
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        throw new ApiError("VALIDATION_ERROR", "파일이 너무 큽니다 (최대 1MB).");
      }
      const text = await file.text();
      if (!text.trim()) throw new ApiError("VALIDATION_ERROR", "파일이 비어 있습니다.");
      if (text.length > MAX_SOURCE_TEXT) {
        throw new ApiError("VALIDATION_ERROR", `PRD가 너무 깁니다 (최대 ${MAX_SOURCE_TEXT}자).`);
      }
      sourceText = text;
      const formTitle = form.get("title");
      title = typeof formTitle === "string" && formTitle.trim()
        ? formTitle.trim()
        : deriveTitle(text, file.name);
      source = "UPLOAD";
    } else {
      const parsed = jsonBody.safeParse(await req.json().catch(() => null));
      if (!parsed.success) {
        return apiError("VALIDATION_ERROR", parsed.error.issues.map((i) => i.message).join(", "));
      }
      sourceText = parsed.data.sourceText;
      title = parsed.data.title?.trim() || deriveTitle(sourceText);
      source = "EDIT";
    }

    const { prd, revision } = await createPrd({ title, sourceText, source, authorId: user.id });

    // 등록 = 생성. 사용자가 "생성" 버튼을 따로 누르지 않는다 (§6.2 T1).
    const { job } = await createJob({ prdId: prd.id, trigger: "T1", userId: user.id });
    runJobDetached(job.id);

    return NextResponse.json(
      toPrdDto({ ...prd, status: "GENERATING" }, { jobId: job.id, currentRevision: revision.revision }),
      { status: 201 }
    );
  });
}
