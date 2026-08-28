import { NextResponse } from "next/server";
import { handle } from "@/lib/api-error";
import { requireUser } from "@/lib/session";
import { toUserDto } from "@/lib/serializers";

export async function GET() {
  return handle(async () => NextResponse.json(toUserDto(await requireUser())));
}
