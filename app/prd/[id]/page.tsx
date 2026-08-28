import { redirect } from "next/navigation";

/** 탭 없는 중간 상태를 만들지 않는다 — §11 */
export default async function PrdIndex({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/prd/${id}/spec`);
}
