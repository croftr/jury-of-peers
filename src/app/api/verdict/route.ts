import { NextResponse } from "next/server";
import { stubVerdict } from "@/lib/deliberate";
import { getJuror } from "@/lib/jurors";
import { JurorError, hasApiKey, requestVerdict } from "@/lib/openrouter";
import type { CaseFile } from "@/lib/types";

export const runtime = "nodejs";
// Twelve models, some of them slow. Don't let the platform cut a juror off.
export const maxDuration = 120;

interface Body {
  jurorId: number;
  caseFile: CaseFile;
  /** How many jurors are empanelled, so the juror knows the size of the room. */
  bench?: number;
  /** This juror's standing instruction from the jury page, if any. */
  instruction?: string;
}

/** Matches MAX_INSTRUCTION on the client; enforced again here. */
const MAX_INSTRUCTION = 1200;

/**
 * One juror, one request, one model. The client fans out twelve of these in
 * parallel, so a slow or failing model costs only its own seat.
 *
 * With no OPENROUTER_API_KEY set, the deterministic stub engine stands in — the
 * UI is fully exercisable offline.
 */
export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Malformed request body." }, { status: 400 });
  }

  const { jurorId, caseFile } = body ?? {};
  const juror = getJuror(jurorId);
  if (!juror) {
    return NextResponse.json({ error: "Unknown juror." }, { status: 404 });
  }
  if (!caseFile?.evidence?.trim()) {
    return NextResponse.json({ error: "No evidence submitted." }, { status: 400 });
  }
  if (!Array.isArray(caseFile.options) || caseFile.options.length !== 2) {
    return NextResponse.json({ error: "A case needs exactly two findings." }, { status: 400 });
  }
  if (!caseFile.options.every((o) => typeof o === "string" && o.trim())) {
    return NextResponse.json({ error: "Both findings need a label." }, { status: 400 });
  }

  if (!hasApiKey()) {
    const verdict = stubVerdict(jurorId, caseFile);
    // Stand in for model latency so the deliberation still staggers.
    await new Promise((r) => setTimeout(r, verdict.deliberationMs));
    return NextResponse.json(verdict);
  }

  const bench =
    Number.isInteger(body.bench) && body.bench! >= 1 && body.bench! <= 12 ? body.bench! : 12;
  const instruction =
    typeof body.instruction === "string"
      ? body.instruction.trim().slice(0, MAX_INSTRUCTION)
      : undefined;

  try {
    return NextResponse.json(await requestVerdict(juror, caseFile, bench, instruction));
  } catch (err) {
    const message =
      err instanceof JurorError ? err.message : "This juror could not be reached.";
    console.error(`Seat ${juror.seat} (${juror.alias}) failed:`, err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
