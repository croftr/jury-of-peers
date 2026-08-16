import { NextResponse } from "next/server";
import { archiveEnabled, deleteCases, isValidId, listCases, saveCase } from "@/lib/archive";
import { MAX_EVIDENCE_BYTES } from "@/lib/estimate";
import { getJuror } from "@/lib/jurors";
import type { CaseFile, Juror, JurorFailure, JurorVerdict, VerdictChoice } from "@/lib/types";

export const runtime = "nodejs";
// The archive is read straight from S3 on every request — a stale list of past
// cases would be worse than a slow one.
export const dynamic = "force-dynamic";

/** Matches MAX_INSTRUCTION on the client; enforced again here. */
const MAX_INSTRUCTION = 1200;
const MAX_TITLE = 200;
const MAX_TEXT = 4000;

interface Body {
  caseFile: CaseFile;
  /** Seat ids that were empanelled, in seat order. */
  bench: number[];
  instructions?: Record<string, string>;
  verdicts: JurorVerdict[];
  /** Where the room stood before it went back out, on a case heard twice. */
  firstRound?: JurorVerdict[];
  failures?: JurorFailure[];
  /**
   * An already-filed record this one replaces. Sent when the second round
   * lands, so a case heard twice is one record rather than two.
   */
  supersedes?: string;
  /**
   * The archived case this one is a retrial of. Unlike `supersedes` this files
   * a *new* record — a different jury on a different day is a different case —
   * and only keeps the lineage.
   */
  retrialOf?: string;
}

const text = (value: unknown, limit: number): string =>
  typeof value === "string" ? value.slice(0, limit) : "";

const clamp = (value: unknown, lo: number, hi: number, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(hi, Math.max(lo, value)) : fallback;

/**
 * Rebuild each verdict from the wire rather than storing what arrived. The
 * client is the only thing that has seen the whole run, so it has to be the one
 * to post it — but nothing it sends is taken on trust.
 */
function cleanVerdict(raw: unknown, seated: Set<number>): JurorVerdict | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Partial<JurorVerdict>;
  if (typeof v.jurorId !== "number" || !seated.has(v.jurorId)) return null;
  if (v.choice !== 0 && v.choice !== 1) return null;

  const usage = v.usage;
  return {
    jurorId: v.jurorId,
    choice: v.choice as VerdictChoice,
    confidence: clamp(v.confidence, 0, 1, 0.5),
    rationale: text(v.rationale, MAX_TEXT),
    pivot: text(v.pivot, 200),
    deliberationMs: clamp(v.deliberationMs, 0, 10 * 60_000, 0),
    source: v.source === "live" ? "live" : "simulated",
    ...(typeof v.model === "string" ? { model: v.model.slice(0, 200) } : {}),
    ...(typeof v.provider === "string" ? { provider: v.provider.slice(0, 100) } : {}),
    ...(usage && typeof usage === "object"
      ? {
          usage: {
            promptTokens: clamp(usage.promptTokens, 0, 1e9, 0),
            completionTokens: clamp(usage.completionTokens, 0, 1e9, 0),
            ...(typeof usage.costUsd === "number" && Number.isFinite(usage.costUsd)
              ? { costUsd: usage.costUsd }
              : {}),
          },
        }
      : {}),
  };
}

/**
 * GET — one page of archived cases, newest first, as one-line summaries.
 *
 * `before` is the last id of the previous page. Paged because the list only
 * shows a screenful, and reading the whole archive to render twenty-five rows
 * was the most expensive thing this app did.
 */
export async function GET(req: Request) {
  if (!archiveEnabled()) {
    return NextResponse.json({ enabled: false, cases: [] });
  }

  const params = new URL(req.url).searchParams;
  const asked = Number(params.get("limit"));
  const before = params.get("before") ?? undefined;

  try {
    const page = await listCases({
      ...(Number.isInteger(asked) && asked > 0 ? { limit: asked } : {}),
      ...(before && isValidId(before) ? { before } : {}),
    });
    return NextResponse.json({ enabled: true, ...page });
  } catch (err) {
    console.error("Could not read the archive:", err);
    return NextResponse.json(
      { error: "The archive could not be reached. Check the bucket configuration." },
      { status: 502 },
    );
  }
}

/**
 * DELETE — strike cases from the record, by explicit id.
 *
 * "Delete all" on the archive page sends every id it is showing rather than a
 * wildcard: nothing can be removed that the person could not see at the moment
 * they confirmed.
 */
export async function DELETE(req: Request) {
  if (!archiveEnabled()) {
    return NextResponse.json({ error: "The archive is not configured." }, { status: 404 });
  }

  let ids: unknown;
  try {
    ({ ids } = (await req.json()) as { ids?: unknown });
  } catch {
    return NextResponse.json({ error: "Malformed request body." }, { status: 400 });
  }

  if (!Array.isArray(ids) || !ids.length || !ids.every((id) => typeof id === "string")) {
    return NextResponse.json({ error: "No cases were named." }, { status: 400 });
  }

  try {
    const { deleted, failed } = await deleteCases(ids as string[]);
    return NextResponse.json({ deleted, failed });
  } catch (err) {
    console.error("Could not strike cases from the archive:", err);
    return NextResponse.json(
      { error: "The archive refused the deletion." },
      { status: 502 },
    );
  }
}

/**
 * POST — commit a completed case.
 *
 * Called once the room has spoken. With no bucket configured this reports that
 * it stored nothing rather than failing: not archiving a case should never cost
 * anyone the verdict they just watched come in.
 */
export async function POST(req: Request) {
  if (!archiveEnabled()) {
    return NextResponse.json({ stored: false, reason: "The archive is not configured." });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Malformed request body." }, { status: 400 });
  }

  const raw = body?.caseFile;
  if (!raw?.evidence?.trim()) {
    return NextResponse.json({ error: "A case needs its evidence." }, { status: 400 });
  }
  // Evidence is stored whole — truncating someone's case would quietly change
  // what the jury was shown — so an oversized one is refused outright. Measured
  // in bytes, because that is what the record ceiling is measured in: checking
  // characters passes text that then fails the write, and by then the verdict
  // has already been paid for.
  if (Buffer.byteLength(raw.evidence, "utf8") > MAX_EVIDENCE_BYTES) {
    return NextResponse.json(
      { error: "This case is too large to archive." },
      { status: 413 },
    );
  }
  if (
    !Array.isArray(raw.options) ||
    raw.options.length !== 2 ||
    !raw.options.every((o) => typeof o === "string" && o.trim())
  ) {
    return NextResponse.json({ error: "A case needs exactly two findings." }, { status: 400 });
  }

  // Snapshot the bench from the server's own roster: the client sends seat ids,
  // never juror data, and the stored record survives later edits to the roster.
  const jurors: Juror[] = (Array.isArray(body.bench) ? body.bench : [])
    .map((id) => getJuror(id))
    .filter((j): j is Juror => Boolean(j));

  if (!jurors.length) {
    return NextResponse.json({ error: "No jury was empanelled." }, { status: 400 });
  }

  const seated = new Set(jurors.map((j) => j.id));
  const verdicts = (Array.isArray(body.verdicts) ? body.verdicts : [])
    .map((v) => cleanVerdict(v, seated))
    .filter((v): v is JurorVerdict => Boolean(v));

  // A case with no findings is not a case. Some seats may be empty — the verdict
  // stands on whoever answered — but at least one juror has to have spoken.
  if (!verdicts.length) {
    return NextResponse.json({ error: "No juror returned a finding." }, { status: 400 });
  }

  // The first round is stored only if it is genuinely a different set of
  // findings — a client that sends it needlessly shouldn't make the record
  // claim the room was asked twice.
  const firstRound = (Array.isArray(body.firstRound) ? body.firstRound : [])
    .map((v) => cleanVerdict(v, seated))
    .filter((v): v is JurorVerdict => Boolean(v));

  const failures: JurorFailure[] = (Array.isArray(body.failures) ? body.failures : [])
    .filter((f) => f && typeof f === "object" && seated.has(f.jurorId))
    .map((f) => ({ jurorId: f.jurorId, message: text(f.message, 500) }));

  const instructions: Record<number, string> = {};
  for (const [key, value] of Object.entries(body.instructions ?? {})) {
    const id = Number(key);
    const kept = text(value, MAX_INSTRUCTION).trim();
    if (seated.has(id) && kept) instructions[id] = kept;
  }

  try {
    const summary = await saveCase(
      {
        caseFile: {
          title: text(raw.title, MAX_TITLE).trim(),
          evidence: raw.evidence,
          options: [text(raw.options[0], 80), text(raw.options[1], 80)],
        },
        jurors,
        instructions,
        verdicts,
        ...(firstRound.length ? { firstRound } : {}),
        ...(typeof body.retrialOf === "string" && isValidId(body.retrialOf)
          ? { retrialOf: body.retrialOf }
          : {}),
        failures,
      },
      typeof body.supersedes === "string" && isValidId(body.supersedes)
        ? body.supersedes
        : undefined,
    );
    return NextResponse.json({ stored: true, summary });
  } catch (err) {
    console.error("Could not archive the case:", err);
    return NextResponse.json({ error: "The case could not be archived." }, { status: 502 });
  }
}
