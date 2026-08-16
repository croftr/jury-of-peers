import { modelFor, type JurorModel } from "./models";
import type { CaseFile, Juror, RoomPosition } from "./types";

/**
 * What a case will cost, and who on the bench can actually read it.
 *
 * Everything here is an estimate made without calling anything, so the court can
 * say what a run will cost and which seats a long case will leave empty *before*
 * anyone commits to it. The same numbers are then enforced on the server, where
 * a case that cannot fit a juror's context is refused rather than sent and paid
 * for — an over-long prompt is a 400 from the provider, and a 400 you could have
 * predicted is money and a seat thrown away.
 *
 * No tokeniser is involved. Twelve models mean twelve tokenisers, and a rough
 * count that is honest about being rough beats a precise count for the wrong
 * model.
 */

/** Matches `max_tokens` on the juror call — the room the reply needs. */
export const REPLY_TOKENS = 1500;

/** A whole case in one archive object. */
export const MAX_RECORD_BYTES = 1_000_000;

/**
 * Everything in a record that is not the evidence: up to twenty-four verdicts
 * on a case heard twice, the bench, the standing instructions, and the failures.
 * Rounded well up — being wrong here means refusing a case that would have fit,
 * which is far better than accepting one that will not and finding out after
 * the jury has already been paid for.
 */
const RECORD_OVERHEAD_BYTES = 180_000;

/**
 * The most evidence a case can carry and still be archivable, in *bytes* —
 * evidence is stored whole, and a character is not a byte the moment anyone
 * pastes an em dash. Derived rather than declared, so it cannot drift from the
 * ceiling it exists to stay under, and it lives here rather than in `archive.ts`
 * so the case form can warn about it without pulling in the S3 client.
 */
export const MAX_EVIDENCE_BYTES = MAX_RECORD_BYTES - RECORD_OVERHEAD_BYTES;

/**
 * The prompt scaffolding around the case: the juror's persona and charge, the
 * schema, the field descriptions. Measured from the assembled prompts and
 * rounded up.
 */
const PROMPT_OVERHEAD = 700;

/**
 * The estimate is a guess, and guessing low is the expensive direction — it
 * spends a call that then fails. Guessing high only excuses a seat that might
 * have coped, and says why.
 */
const SAFETY = 1.15;

/** What a juror typically writes back: rationale, sticking point, the rest. */
const TYPICAL_REPLY = 350;

/**
 * Roughly how many tokens some text will take.
 *
 * About four characters to the token for English prose, with a floor derived
 * from the word count so a wall of very short words is not badly undercounted.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const trimmed = text.trim();
  if (!trimmed) return 0;
  const words = trimmed.split(/\s+/).length;
  return Math.max(Math.ceil(text.length / 4), Math.ceil(words * 1.3));
}

/** Everything one juror is sent for a first-round verdict. */
export function promptTokens(caseFile: CaseFile, instruction?: string): number {
  return (
    estimateTokens(caseFile.evidence) +
    estimateTokens(caseFile.title) +
    estimateTokens(instruction ?? "") +
    PROMPT_OVERHEAD
  );
}

/** The room, as it is put to a juror in the second round. */
export function roomTokens(room: RoomPosition[]): number {
  return room.reduce(
    (sum, p) => sum + estimateTokens(p.rationale) + estimateTokens(p.pivot) + 30,
    // The charge that comes with the room, and the poll line above it.
    260,
  );
}

/**
 * Whether a model can hold this prompt and still have room to answer.
 *
 * The window has to fit the prompt *and* the reply — a model that can read the
 * case but cannot answer it is no more use than one that cannot read it.
 */
export function fits(model: JurorModel, prompt: number): boolean {
  return Math.ceil(prompt * SAFETY) + REPLY_TOKENS <= model.context;
}

/** The largest case, in tokens, this model could be asked to read. */
export function capacity(model: JurorModel): number {
  return Math.floor((model.context - REPLY_TOKENS) / SAFETY);
}

/**
 * Why this juror cannot read this case, or null if they can.
 *
 * The one place the refusal is worded, so the court, the rehearsal and the live
 * call all say the same thing. Sent to a real model an over-long prompt is a
 * 400 that is not retryable and not worth paying for; the rehearsal honours the
 * same limit so an offline run is a faithful rehearsal rather than a jury that
 * can read anything.
 */
export function readabilityError(
  juror: Juror,
  caseFile: CaseFile,
  instruction?: string,
  extraTokens = 0,
): string | null {
  const model = modelFor(juror.id);
  if (!model) return null;

  const prompt = promptTokens(caseFile, instruction) + extraTokens;
  if (fits(model, prompt)) return null;

  return (
    `This case is too long for ${model.label} to read — about ${prompt.toLocaleString()} ` +
    `tokens against a ${model.context.toLocaleString()}-token window. ` +
    `Seat ${juror.seat} can hear roughly ${capacity(model).toLocaleString()} tokens.`
  );
}

export interface Excused {
  juror: Juror;
  model: JurorModel;
  /** Their context window, for saying plainly why they cannot sit on this case. */
  context: number;
}

/**
 * Who on this bench cannot read this case, smallest window first.
 *
 * Called on the client to warn before the jury goes out, so a long case does
 * not quietly cost someone three empty seats and a worse verdict.
 */
export function cannotRead(
  bench: Juror[],
  caseFile: CaseFile,
  instructions: Record<number, string> = {},
): Excused[] {
  return bench
    .flatMap((juror) => {
      const model = modelFor(juror.id);
      if (!model) return [];
      const prompt = promptTokens(caseFile, instructions[juror.id]);
      return fits(model, prompt) ? [] : [{ juror, model, context: model.context }];
    })
    .sort((a, b) => a.context - b.context);
}

/**
 * What one round across this bench will cost, in USD.
 *
 * The reply length is assumed rather than known — it cannot be known before the
 * models answer — so this is honest about being an estimate. The exact figure
 * is reported under the verdict once the tokens are real.
 */
export function estimateCost(
  bench: Juror[],
  caseFile: CaseFile,
  instructions: Record<number, string> = {},
  extraPromptTokens = 0,
): number {
  return bench.reduce((sum, juror) => {
    const model = modelFor(juror.id);
    if (!model) return sum;
    const prompt = promptTokens(caseFile, instructions[juror.id]) + extraPromptTokens;
    // A juror who cannot read the case is never called, so they cost nothing.
    if (!fits(model, prompt)) return sum;
    return sum + (prompt * model.inPerM + TYPICAL_REPLY * model.outPerM) / 1_000_000;
  }, 0);
}

/**
 * What one juror costs on a case the size of the sample — the figure the
 * empanelment screen sorts and totals by, before there is a case to measure.
 */
export function nominalCost(model: JurorModel): number {
  return (1200 * model.inPerM + TYPICAL_REPLY * model.outPerM) / 1_000_000;
}
