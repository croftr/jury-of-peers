import { NextResponse } from "next/server";
import { getJuror } from "@/lib/jurors";
import { costOf } from "@/lib/models";
import {
  CancelledError,
  DEFAULT_QUESTION,
  JurorError,
  hasApiKey,
  requestExplanation,
} from "@/lib/openrouter";
import { MODEL_CALLS, limited } from "@/lib/rateLimit";
import type { CaseFile, JurorExplanation, JurorVerdict } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

interface Body {
  jurorId: number;
  caseFile: CaseFile;
  verdict: JurorVerdict;
  bench?: number;
  instruction?: string;
  question?: string;
}

const MAX_INSTRUCTION = 1200;
const MAX_QUESTION = 500;

/**
 * Ask one juror to expand on a finding they have already given.
 *
 * Separate from /api/verdict because it is a separate, opt-in call the user
 * pays for by asking — the verdict run never triggers it.
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

  const { jurorId, caseFile, verdict } = body ?? {};
  const juror = getJuror(jurorId);
  if (!juror) {
    return NextResponse.json({ error: "Unknown juror." }, { status: 404 });
  }
  if (!caseFile?.evidence?.trim() || !Array.isArray(caseFile.options)) {
    return NextResponse.json({ error: "The case file is missing." }, { status: 400 });
  }
  if (!verdict || (verdict.choice !== 0 && verdict.choice !== 1)) {
    return NextResponse.json(
      { error: "This juror has no finding to explain." },
      { status: 400 },
    );
  }

  const question = (body.question ?? "").trim().slice(0, MAX_QUESTION);
  const bench =
    Number.isInteger(body.bench) && body.bench! >= 1 && body.bench! <= 12 ? body.bench! : 12;
  const instruction =
    typeof body.instruction === "string"
      ? body.instruction.trim().slice(0, MAX_INSTRUCTION)
      : undefined;

  if (!hasApiKey()) {
    const explanation: JurorExplanation = {
      jurorId,
      question: question || DEFAULT_QUESTION,
      text:
        `${verdict.rationale}\n\nBeyond that there is nothing more to give: no API key is set, so ` +
        `this juror is the offline stub rather than a model. Add OPENROUTER_API_KEY and charge the ` +
        `jury again to put the question to ${juror.alias} for real.`,
      source: "simulated",
    };
    return NextResponse.json(explanation);
  }

  try {
    const { text, usage } = await requestExplanation(
      juror,
      caseFile,
      verdict,
      bench,
      instruction,
      question,
      req.signal,
    );
    const explanation: JurorExplanation = {
      jurorId,
      question: question || DEFAULT_QUESTION,
      text,
      source: "live",
      usage: {
        ...usage,
        costUsd: costOf(jurorId, usage.promptTokens, usage.completionTokens),
      },
    };
    return NextResponse.json(explanation);
  } catch (err) {
    if (err instanceof CancelledError) {
      return NextResponse.json({ error: err.message }, { status: 499 });
    }
    const message =
      err instanceof JurorError ? err.message : "This juror could not be reached.";
    console.error(`Seat ${juror.seat} (${juror.alias}) could not explain:`, err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
