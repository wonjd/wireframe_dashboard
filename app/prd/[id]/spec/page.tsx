import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { SpecEditor } from "@/components/prd/spec-editor";

export const dynamic = "force-dynamic";

export default async function SpecTab({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const prd = await db.prd.findUnique({ where: { id } });
  if (!prd) notFound();

  const activeJob = await db.generationJob.findFirst({
    where: { prdId: id, status: { in: ["PENDING", "RUNNING"] } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  return (
    <SpecEditor
      prdId={id}
      initialTitle={prd.title}
      initialText={prd.sourceText}
      activeJobId={activeJob?.id ?? null}
    />
  );
}
