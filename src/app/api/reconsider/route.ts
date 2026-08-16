import { NextResponse } from "next/server";
import { stubReconsideration } from "@/lib/deliberate";
import { readabilityError, roomTokens } from "@/lib/estimate";
import { getJuror } from "@/lib/jurors";
import {
  CancelledError,
  JurorError,
  hasApiKey,
  requestReconsideration,
} from "@/lib/openrouter";
import { MODEL_CALLS, limited } from "@/lib/rateLimit";
import type { CaseFile, Juror, JurorVerdict, RoomPosition } from "@/lib/types";

export const runtime = "nodejs";
// The second round carries the whole room in its prompt, so it is the slower of
// the two. Same ceiling as the first — a juror is never cut off by the platform.
export const maxDuration = 120;

interface Body {
  jurorId: number;
  caseFile: CaseFile;
  /** This juror's own first-round finding, which they are being asked to revisit. */
  own: JurorVerdict;
  /** What everyone else found, first round. This juror's own seat is not in it. */
  room: RoomPosition[];
  bench?: number;
  instruction?: string;
}

/** Matches MAX_INSTRUCTION on the client; enforced again here. */
const MAX_INSTRUCTION = 1200;
/** Long enough to be an argument. The model call trims further. */
const MAX_ROOM_RATIONALE = 2000;

const isChoice = (v: unknown): v is 0 | 1 => v === 0 || v === 1;

/**
 * Rebuild one juror's position from the wire.
 *
 * Only the finding and the argument survive: a juror weighing what the room
 * said has no business seeing which model said it. Identity comes from the
 * server's own roster, keyed by seat id, so the client cannot put words in a
 * juror's mouth under a name it chose.
 */
function cleanPosition(raw: unknown, self: number): { juror: Juror; position: RoomPosition } | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Partial<RoomPosition>;
  if (typeof p.jurorId !== "number" || p.jurorId === self) return null;
  if (!isChoice(p.choice)) return null;

  const juror = getJuror(p.jurorId);
  if (!juror) return null;

  const confidence =
    typeof p.confidence === "number" && Number.isFinite(p.confidence)
      ? Math.min(1, Math.max(0, p.confidence))
      : 0.7;

  return {
    juror,
    position: {
      jurorId: p.jurorId,
      choice: p.choice,
      confidence,
      rationale:
        typeof p.rationale === "string" ? p.rationale.slice(0, MAX_ROOM_RATIONALE).trim() : "",
      pivot: typeof p.pivot === "string" ? p.pivot.slice(0, 200).trim() : "the evidence as a whole",
    },
  };
}

/**
 * One juror, asked a second time — this time having heard the room.
 *
 * Fanned out per seat exactly like /api/verdict, so a model that fails on the
 * second round costs only its own seat, and the court keeps that juror's first
 * finding rather than losing the vote.
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

  const { jurorId, caseFile, own } = body ?? {};
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
  if (!own || !isChoice(own.choice)) {
    return NextResponse.json(
      { error: "This juror has no first finding to reconsider." },
      { status: 400 },
    );
  }

  const room = (Array.isArray(body.room) ? body.room : [])
    .map((p) => cleanPosition(p, jurorId))
    .filter((p): p is { juror: Juror; position: RoomPosition } => Boolean(p));

  // Nobody to hear is nobody to reconsider in front of. The court should never
  // have asked, and spending a call to be told nothing changed helps no one.
  if (!room.length) {
    return NextResponse.json(
      { error: "There is no room to hear — this juror deliberated alone." },
      { status: 400 },
    );
  }

  const bench =
    Number.isInteger(body.bench) && body.bench! >= 1 && body.bench! <= 12 ? body.bench! : 12;
  const instruction =
    typeof body.instruction === "string"
      ? body.instruction.trim().slice(0, MAX_INSTRUCTION)
      : undefined;

  // The room rides on top of the case here, so a juror who could read the file
  // in the first round may not be able to read it in the second.
  const unreadable = readabilityError(
    juror,
    caseFile,
    instruction,
    roomTokens(room.map((r) => r.position)),
  );
  if (unreadable) {
    return NextResponse.json({ error: unreadable }, { status: 413 });
  }

  if (!hasApiKey()) {
    const verdict = stubReconsideration(
      jurorId,
      caseFile,
      own,
      room.map((r) => r.position),
    );
    await new Promise((r) => setTimeout(r, verdict.deliberationMs));
    return NextResponse.json(verdict);
  }

  try {
    return NextResponse.json(
      await requestReconsideration(juror, caseFile, own, room, bench, instruction, req.signal),
    );
  } catch (err) {
    if (err instanceof CancelledError) {
      return NextResponse.json({ error: err.message }, { status: 499 });
    }
    const message =
      err instanceof JurorError ? err.message : "This juror could not be reached.";
    console.error(`Seat ${juror.seat} (${juror.alias}) failed to reconsider:`, err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
