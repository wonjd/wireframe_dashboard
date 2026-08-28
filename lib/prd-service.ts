import { createHash } from "node:crypto";
import { db } from "./db";
import { ApiError } from "./api-error";
import type { GenTrigger, RevisionSource } from "./constants";

/** §6.2/§8.1 — 본문 변경 판정과 stale 판정의 기준값. */
export function hashContent(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * PRD 등록. 리비전 1을 함께 만든다.
 *
 * Prd.sourceText는 최신 리비전과 같은 값을 갖는 의도적 비정규화이므로(§9),
 * 둘을 반드시 한 트랜잭션에서 쓴다 — 어긋나면 stale 판정이 통째로 틀어진다.
 */
export async function createPrd(input: {
  title: string;
  sourceText: string;
  source: RevisionSource;
  authorId: string;
}) {
  const contentHash = hashContent(input.sourceText);

  return db.$transaction(async (tx) => {
    const prd = await tx.prd.create({
      data: {
        title: input.title,
        sourceText: input.sourceText,
        contentHash,
        status: "DRAFT",
        createdById: input.authorId,
      },
    });

    const revision = await tx.prdRevision.create({
      data: {
        prdId: prd.id,
        revision: 1,
        sourceText: input.sourceText,
        contentHash,
        source: input.source,
        authorId: input.authorId,
      },
    });

    return { prd, revision };
  });
}

/**
 * PRD 수정.
 *
 * 본문이 실제로 바뀐 경우에만 리비전을 append한다 — title만 고치거나 같은 내용을
 * 다시 저장하면 이력이 의미 없는 행으로 부풀기 때문이다 (§8.1).
 * 반환값의 revision이 null이면 "본문 변경 없음" = 재생성도 돌지 않는다.
 */
export async function updatePrd(input: {
  prdId: string;
  title?: string;
  sourceText?: string;
  source: RevisionSource;
  authorId: string;
}) {
  const prd = await db.prd.findUnique({ where: { id: input.prdId } });
  if (!prd) throw new ApiError("NOT_FOUND", "PRD를 찾을 수 없습니다.");

  const nextText = input.sourceText ?? prd.sourceText;
  const nextHash = hashContent(nextText);
  const bodyChanged = nextHash !== prd.contentHash;

  return db.$transaction(async (tx) => {
    if (!bodyChanged) {
      const updated = await tx.prd.update({
        where: { id: prd.id },
        data: { title: input.title ?? prd.title },
      });
      return { prd: updated, revision: null };
    }

    const last = await tx.prdRevision.findFirst({
      where: { prdId: prd.id },
      orderBy: { revision: "desc" },
      select: { revision: true },
    });

    const revision = await tx.prdRevision.create({
      data: {
        prdId: prd.id,
        revision: (last?.revision ?? 0) + 1,
        sourceText: nextText,
        contentHash: nextHash,
        source: input.source,
        authorId: input.authorId,
      },
    });

    const updated = await tx.prd.update({
      where: { id: prd.id },
      data: {
        title: input.title ?? prd.title,
        sourceText: nextText,
        contentHash: nextHash,
      },
    });

    return { prd: updated, revision };
  });
}

export async function getLatestRevision(prdId: string) {
  return db.prdRevision.findFirst({
    where: { prdId },
    orderBy: { revision: "desc" },
  });
}

/** 진행 중인 Job — 중복 생성/중복 과금 방지에 쓴다 (§6.2). */
export async function findActiveJob(prdId: string) {
  return db.generationJob.findFirst({
    where: { prdId, status: { in: ["PENDING", "RUNNING"] } },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * 생성 Job을 만든다. 이미 진행 중이면 새로 만들지 않고 기존 것을 돌려준다.
 * 자동 트리거가 연달아 들어와도 생성이 중복으로 돌지 않게 하는 지점이다.
 */
export async function createJob(input: {
  prdId: string;
  trigger: GenTrigger;
  userId: string;
}) {
  const active = await findActiveJob(input.prdId);
  if (active) return { job: active, created: false };

  const job = await db.generationJob.create({
    data: {
      prdId: input.prdId,
      trigger: input.trigger,
      triggeredById: input.userId,
      status: "PENDING",
    },
  });
  await db.prd.update({ where: { id: input.prdId }, data: { status: "GENERATING" } });
  return { job, created: true };
}

/** 와이어프레임이 현재 PRD 기준인지 — §6.3 */
export function isStale(wireframePrdRevisionId: string, currentRevisionId: string | null): boolean {
  return currentRevisionId === null || wireframePrdRevisionId !== currentRevisionId;
}
