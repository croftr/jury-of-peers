import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { archiveEnabled, loadCase } from "@/lib/archive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — one archived case in full, enough to replay it as it happened. */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/cases/[id]">) {
  if (!archiveEnabled()) {
    return NextResponse.json({ error: "The archive is not configured." }, { status: 404 });
  }

  const { id } = await ctx.params;

  try {
    const record = await loadCase(id);
    if (!record) {
      return NextResponse.json({ error: "No such case." }, { status: 404 });
    }
    return NextResponse.json(record);
  } catch (err) {
    console.error(`Could not read case ${id}:`, err);
    return NextResponse.json(
      { error: "The archive could not be reached." },
      { status: 502 },
    );
  }
}
