import { NextResponse } from "next/server";
import { hasApiKey } from "@/lib/openrouter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Lets the UI say up front whether the jury is real or simulated. */
export async function GET() {
  return NextResponse.json({ live: hasApiKey() });
}
