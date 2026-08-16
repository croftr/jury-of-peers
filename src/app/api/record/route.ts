import { NextResponse } from "next/server";
import { archiveEnabled, listAllSummaries } from "@/lib/archive";
import { buildRecord } from "@/lib/record";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET — what the whole archive says about the jurors.
 *
 * Reads every summary, which is the expensive read this app otherwise avoids —
 * but a statement about the archive has to read the archive, and this is a page
 * asked for rather than landed on. The statistics are computed here so the
 * client is sent twelve rows instead of two hundred and fifty summaries.
 */
export async function GET() {
  if (!archiveEnabled()) {
    return NextResponse.json({ enabled: false });
  }

  try {
    return NextResponse.json({ enabled: true, record: buildRecord(await listAllSummaries()) });
  } catch (err) {
    console.error("Could not read the record:", err);
    return NextResponse.json(
      { error: "The archive could not be reached. Check the bucket configuration." },
      { status: 502 },
    );
  }
}
