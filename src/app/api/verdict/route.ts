import { NextResponse } from "next/server";
import { stubVerdict } from "@/lib/deliberate";
import { readabilityError } from "@/lib/estimate";
import { getJuror } from "@/lib/jurors";
import { CancelledError, JurorError, hasApiKey, requestVerdict } from "@/lib/openrouter";
import { MODEL_CALLS, limited } from "@/lib/rateLimit";
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
  const brake = limited(req, MODEL_CALLS);
  if (brake) return brake;

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

  const bench =
    Number.isInteger(body.bench) && body.bench! >= 1 && body.bench! <= 12 ? body.bench! : 12;
  const instruction =
    typeof body.instruction === "string"
      ? body.instruction.trim().slice(0, MAX_INSTRUCTION)
      : undefined;

  // Checked before the rehearsal branch as well as the live one: a juror whose
  // model could not hold this case should not quietly return a finding just
  // because no key is set. Rehearsal is meant to be a faithful rehearsal.
  const unreadable = readabilityError(juror, caseFile, instruction);
  if (unreadable) {
    return NextResponse.json({ error: unreadable }, { status: 413 });
  }

  if (!hasApiKey()) {
    const verdict = stubVerdict(jurorId, caseFile);
    // Stand in for model latency so the deliberation still staggers.
    await new Promise((r) => setTimeout(r, verdict.deliberationMs));
    return NextResponse.json(verdict);
  }

  try {
    return NextResponse.json(
      await requestVerdict(juror, caseFile, bench, instruction, req.signal),
    );
  } catch (err) {
    // The court hung up. Nobody is waiting for this and nothing went wrong, so
    // it is not worth a line in the log.
    if (err instanceof CancelledError) {
      return NextResponse.json({ error: err.message }, { status: 499 });
    }
    const message =
      err instanceof JurorError ? err.message : "This juror could not be reached.";
    console.error(`Seat ${juror.seat} (${juror.alias}) failed:`, err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
