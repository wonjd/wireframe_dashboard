import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getLatestRevision } from "@/lib/prd-service";
import { wireframeDocSchema } from "@/lib/wireframe/schema";
import { toWireframeListItem } from "@/lib/serializers";
import { WireframeTab } from "@/components/wireframe/wireframe-tab";
import type { WireframeDoc } from "@/lib/wireframe/types";

export const dynamic = "force-dynamic";

export default async function WireframePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const prd = await db.prd.findUnique({ where: { id }, select: { id: true } });
  if (!prd) notFound();

  const [wireframes, current] = await Promise.all([
    db.wireframe.findMany({
      where: { prdId: id },
      orderBy: { version: "desc" },
      include: {
        prdRevision: { include: { author: { select: { id: true, name: true, email: true } } } },
      },
    }),
    getLatestRevision(id),
  ]);

  const versions = wireframes.map((w) =>
    toWireframeListItem(w, current?.id ?? null, w.prdRevision)
  );

  // 최신 버전을 미리 파싱해 내려보낸다 — 첫 페인트에 fetch 왕복을 없앤다.
  let initialDoc: WireframeDoc | null = null;
  const latest = wireframes[0];
  if (latest) {
    const parsed = wireframeDocSchema.safeParse(JSON.parse(latest.docJson));
    if (parsed.success) initialDoc = parsed.data;
  }

  return (
    <WireframeTab
      prdId={id}
      initialVersions={JSON.parse(JSON.stringify(versions))}
      initialDoc={initialDoc}
      initialWireframeId={latest?.id ?? null}
    />
  );
}
