import type { Prd, PrdRevision, User, Wireframe } from "@prisma/client";
import { isStale } from "./prd-service";

/** API 응답 형태를 한곳에서 고정한다 — §10.2. */

export function toUserDto(u: Pick<User, "id" | "name" | "email">) {
  return { id: u.id, name: u.name, email: u.email };
}

export function toPrdListItem(
  p: Prd & { createdBy?: Pick<User, "id" | "name" | "email"> | null },
  extra: { latestWireframeVersion: number | null; lastEditor: Pick<User, "id" | "name" | "email"> | null }
) {
  return {
    id: p.id,
    title: p.title,
    status: p.status,
    latestWireframeVersion: extra.latestWireframeVersion,
    lastEditor: extra.lastEditor ? toUserDto(extra.lastEditor) : null,
    updatedAt: p.updatedAt,
  };
}

export function toPrdDto(p: Prd, extra?: { jobId?: string | null; currentRevision?: number }) {
  return {
    id: p.id,
    title: p.title,
    sourceText: p.sourceText,
    status: p.status,
    currentRevision: extra?.currentRevision ?? null,
    jobId: extra?.jobId ?? null,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

export function toWireframeListItem(
  w: Wireframe,
  currentRevisionId: string | null,
  revision?: (PrdRevision & { author: Pick<User, "id" | "name" | "email"> }) | null
) {
  return {
    id: w.id,
    version: w.version,
    model: w.model,
    isStale: isStale(w.prdRevisionId, currentRevisionId),
    basedOn: revision
      ? { revisionId: revision.id, revision: revision.revision, author: toUserDto(revision.author), createdAt: revision.createdAt }
      : null,
    createdAt: w.createdAt,
  };
}

export function toRevisionListItem(
  r: PrdRevision & { author: Pick<User, "id" | "name" | "email"> },
  extra: { isCurrent: boolean; wireframeVersions: number[] }
) {
  return {
    id: r.id,
    revision: r.revision,
    source: r.source,
    author: toUserDto(r.author),
    createdAt: r.createdAt,
    isCurrent: extra.isCurrent,
    wireframeVersions: extra.wireframeVersions,
  };
}
