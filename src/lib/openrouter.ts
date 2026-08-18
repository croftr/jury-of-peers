import { estimateTokens, readabilityError, roomTokens } from "./estimate";
import { costOf, modelFor, type JurorModel } from "./models";
import { caseMode } from "./types";
import type { CaseFile, Juror, JurorVerdict, RoomPosition, VerdictChoice } from "./types";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

/** Per-juror wall-clock ceiling. A juror that exceeds it is reported unreachable. */
const TIMEOUT_MS = 90_000;

export class JurorError extends Error {
  /** Worth one more shot: a flaky provider, not a broken key or a bad request. */
  readonly retryable: boolean;
  constructor(message: string, retryable = false) {
    super(message);
    this.retryable = retryable;
  }
}

/** Raised when the court gave up on this juror, rather than the juror failing. */
export class CancelledError extends Error {
  constructor() {
    super("This juror was called back before they answered.");
  }
}

/**
 * When to stop waiting: the juror's own ceiling, or the caller walking away.
 *
 * Threading the request's signal through is what makes "start over" cost
 * nothing. Without it the browser hangs up, the route keeps waiting, and the
 * call is billed in full for an answer nobody will ever see.
 */
function deadline(abort?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  return abort ? AbortSignal.any([abort, timeout]) : timeout;
}

/** Distinguish "we hung up" from "the model failed", which read very differently. */
function classify(err: unknown, model: JurorModel, abort?: AbortSignal): never {
  if (abort?.aborted) throw new CancelledError();
  const reason =
    err instanceof Error && err.name === "TimeoutError" ? "timed out" : "could not be reached";
  throw new JurorError(`${model.label} ${reason}.`, true);
}

/**
 * Wait a moment before trying again.
 *
 * An immediate retry of a 429 is a second 429 — the thing that rate-limited us
 * has not changed its mind in nought milliseconds. Jittered so twelve jurors
 * failing together do not all come back at the same instant.
 */
function pause(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 500 + Math.random() * 1000));
}

export function hasApiKey(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY?.trim());
}

/**
 * Refuse a case that cannot fit this juror's context, before spending on it.
 *
 * Checked here rather than in the route so both rounds and the follow-up
 * question get it for free. The wording lives in `estimate.ts`, which is also
 * what the case form warns with, so the court and the call cannot disagree.
 */
function assertReadable(
  juror: Juror,
  caseFile: CaseFile,
  instruction?: string,
  extraTokens = 0,
): void {
  const reason = readabilityError(juror, caseFile, instruction, extraTokens);
  if (reason) throw new JurorError(reason);
}

const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const spell = (n: number) => WORDS[n] ?? String(n);

/**
 * How the jury is charged, by mode.
 *
 * The trial rules are the strict ones: the record is the whole world, and a gap
 * in it is a finding about the record rather than an invitation to fill it.
 *
 * The decision rules deliberately invert that — a brief asking which car to buy
 * cannot contain what the jury needs to know about cars — and then spend most of
 * their length on the failure mode that opens up the moment they do. A model
 * told to use what it knows will produce a service interval, a resale figure or
 * a recall notice that reads exactly like the real thing, so the rules ask for
 * the provenance of every point and for uncertainty to be worn openly rather
 * than rounded off into confidence.
 */
function charge(caseFile: CaseFile, archetype: string): string {
  if (caseMode(caseFile.mode) === "decision") {
    return `Rules of deliberation:
- The brief is where you start, not where you stop. Bring what you know about this kind of choice — how these things usually work out, what the common regrets are, what turns out to matter more in practice than it does on paper.
- Keep the two apart. Where a point comes from the brief, say so; where it comes from your own knowledge, say that instead. Never dress the second up as the first.
- Do not manufacture precision. If you are unsure of a figure, a date, or a specific claim, say you are unsure rather than inventing one that sounds authoritative. An approximate claim, honestly flagged, is worth more than a confident invention.
- Requirements, constraints and budgets stated in the brief are binding. What you know can tell you how well an option meets them; it cannot excuse an option from having to.
- Your disposition is how you weigh a choice, not an answer you owe. A ${archetype} reading of a close call and of a lopsided one should not land in the same place.
- Name the single consideration that actually decided it for you. Not the most persuasive-sounding one — the load-bearing one.`;
  }

  return `Rules of deliberation:
- Decide only on the evidence supplied. Do not invent facts, witnesses, documents, or law that the case file does not contain.
- If the evidence is thin, that is itself a finding about the evidence — say so and let it move you, rather than filling the gap with assumption.
- Your disposition is how you read evidence, not a verdict you owe. A ${archetype} reading of a weak case and a strong one should not land in the same place.
- Name the single fact, gap, or contradiction that actually decided it for you. Not the most dramatic one — the load-bearing one.`;
}

function systemPrompt(
  juror: Juror,
  caseFile: CaseFile,
  bench: number,
  instruction?: string,
): string {
  const decision = caseMode(caseFile.mode) === "decision";
  const archetype = juror.archetype.toLowerCase();

  const standing = instruction?.trim()
    ? `

STANDING INSTRUCTION
The court has given you this instruction for this matter. It shapes how you weigh ${
        decision ? "the options" : "the evidence"
      } and what you treat as important. It does not let you abandon the two findings, invent facts, or ${
        decision ? "set aside what the brief requires" : "ignore the record"
      }:
"""
${instruction.trim()}
"""`
    : "";

  const others =
    bench > 1
      ? `The other ${spell(bench - 1)} juror${bench - 1 === 1 ? "" : "s"} reach their own findings independently, and the room is polled afterwards`
      : "You are the only juror empanelled, and your finding alone decides the matter";

  return `You are Juror ${juror.seat} of ${spell(bench)} on a jury. You are known as "${juror.alias}".

Your disposition as a ${archetype} reader of a case: ${juror.disposition}

You are deliberating alone. ${others} — so do not hedge toward an imagined consensus, and do not soften a finding to seem balanced. Reason from the material in front of you and commit.

The question before you admits exactly two findings: "${caseFile.options[0]}" or "${caseFile.options[1]}". You must return one of them.

${charge(caseFile, archetype)}${standing}

Return your finding as JSON and nothing else.`;
}

function userPrompt(caseFile: CaseFile): string {
  const decision = caseMode(caseFile.mode) === "decision";

  return `MATTER: ${caseFile.title || "Untitled matter"}

${decision ? "THE BRIEF BEFORE THE JURY" : "THE EVIDENCE AND ARGUMENT BEFORE THE JURY"}
${caseFile.evidence}

Return JSON with:
  finding         — exactly "${caseFile.options[0]}" or "${caseFile.options[1]}"
  confidence      — a number from 0.5 to 1 for how sure you are of that finding
  rationale       — 2 to 4 sentences in your own voice as this juror, explaining what decided it${
    decision ? ", making clear as you go which points come from the brief and which from what you know" : ""
  }
  sticking_point  — the single ${
    decision ? "consideration" : "fact, gap, or contradiction"
  } that carried the most weight, as a short phrase`;
}

function schema(caseFile: CaseFile) {
  return {
    name: "juror_verdict",
    strict: true,
    schema: {
      type: "object",
      properties: {
        finding: { type: "string", enum: [caseFile.options[0], caseFile.options[1]] },
        confidence: { type: "number" },
        rationale: { type: "string" },
        sticking_point: { type: "string" },
      },
      required: ["finding", "confidence", "rationale", "sticking_point"],
      additionalProperties: false,
    },
  };
}

/**
 * Ask one juror for a verdict.
 *
 * Every juror is a separate request to a separate model, so one slow or broken
 * model delays or fails only its own seat. Soft failures — a provider that
 * ignores the schema, an empty completion — are retried once, because they are
 * intermittent; auth and billing errors are not, because they won't improve.
 */
export async function requestVerdict(
  juror: Juror,
  caseFile: CaseFile,
  bench: number,
  instruction?: string,
  abort?: AbortSignal,
): Promise<JurorVerdict> {
  try {
    return await attemptVerdict(juror, caseFile, bench, instruction, abort);
  } catch (err) {
    if (err instanceof JurorError && err.retryable) {
      await pause();
      if (abort?.aborted) throw new CancelledError();
      return attemptVerdict(juror, caseFile, bench, instruction, abort);
    }
    throw err;
  }
}

async function attemptVerdict(
  juror: Juror,
  caseFile: CaseFile,
  bench: number,
  instruction?: string,
  abort?: AbortSignal,
): Promise<JurorVerdict> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new JurorError("OPENROUTER_API_KEY is not set.");

  const model = modelFor(juror.id);
  if (!model) throw new JurorError(`No model assigned to seat ${juror.seat}.`);

  assertReadable(juror, caseFile, instruction);

  const startedAt = Date.now();

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      signal: deadline(abort),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        // Attribution on the OpenRouter dashboard; both are optional.
        "HTTP-Referer": process.env.OPENROUTER_SITE_URL ?? "http://localhost:3000",
        "X-Title": "Jury of Peers",
      },
      body: JSON.stringify({
        model: model.slug,
        max_tokens: 1500,
        messages: [
          { role: "system", content: systemPrompt(juror, caseFile, bench, instruction) },
          { role: "user", content: userPrompt(caseFile) },
        ],
        response_format: { type: "json_schema", json_schema: schema(caseFile) },
        // Only route to providers that actually honour the schema. Without this,
        // a request can land on one that ignores response_format and answers in
        // prose — the observed cause of Llama returning no JSON at all.
        provider: { require_parameters: true },
        // Per-model, because the right answer differs — see ReasoningPolicy.
        ...(model.reasoning === "off"
          ? { reasoning: { enabled: false } }
          : model.reasoning === "low"
            ? { reasoning: { effort: "low" } }
            : {}),
      }),
    });
  } catch (err) {
    classify(err, model, abort);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    // 429 and 5xx are worth another try; 400/401/402/404 are not.
    const retryable = res.status === 429 || res.status >= 500;
    throw new JurorError(
      `${model.label} returned ${res.status}. ${extractError(detail)}`.trim(),
      retryable,
    );
  }

  const body = (await res.json()) as {
    choices?: { message?: { content?: string }; finish_reason?: string }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    /** What actually served the request — not necessarily what we asked for. */
    model?: string;
    provider?: string;
    error?: { message?: string };
  };

  // OpenRouter can return a 200 whose body carries an upstream error.
  if (body.error) throw new JurorError(`${model.label}: ${body.error.message ?? "upstream error"}`);

  const choice = body.choices?.[0];
  const content = choice?.message?.content;
  if (!content?.trim()) {
    throw new JurorError(
      choice?.finish_reason === "length"
        ? `${model.label} ran out of tokens before answering.`
        : `${model.label} returned an empty finding.`,
      true,
    );
  }

  const parsed = parseVerdict(content, caseFile);
  const promptTokens = body.usage?.prompt_tokens ?? 0;
  const completionTokens = body.usage?.completion_tokens ?? 0;

  return {
    jurorId: juror.id,
    ...parsed,
    deliberationMs: Date.now() - startedAt,
    source: "live",
    round: 1,
    // Report what served the request, not what we asked for.
    model: body.model ?? model.slug,
    provider: body.provider,
    usage: {
      promptTokens,
      completionTokens,
      costUsd: costOf(juror.id, promptTokens, completionTokens),
    },
  };
}

/** A juror's own finding, replayed as their previous turn so a follow-up continues it. */
function ownTurn(caseFile: CaseFile, verdict: JurorVerdict) {
  return {
    role: "assistant" as const,
    content: JSON.stringify({
      finding: caseFile.options[verdict.choice],
      confidence: Number(verdict.confidence.toFixed(2)),
      rationale: verdict.rationale,
      sticking_point: verdict.pivot,
    }),
  };
}

/** One other juror's argument, long enough to be an argument and no longer. */
const MAX_ROOM_RATIONALE = 900;

/** What the room said, in seat order — the order is fixed so it carries no lean. */
function roomReport(
  caseFile: CaseFile,
  room: { juror: Juror; position: RoomPosition }[],
): string {
  const counts: [number, number] = [0, 0];
  for (const { position } of room) counts[position.choice]++;

  const voices = room
    .map(({ juror, position }) => {
      const rationale = position.rationale.slice(0, MAX_ROOM_RATIONALE).trim();
      return `Juror ${juror.seat} · ${juror.alias} — ${caseFile.options[position.choice]} (${Math.round(
        position.confidence * 100,
      )}% sure)
Sticking point: ${position.pivot}
"${rationale}"`;
    })
    .join("\n\n");

  return `THE ROOM HAS BEEN POLLED

Setting your own finding aside, the other ${spell(room.length)} juror${room.length === 1 ? "" : "s"} stand at ${caseFile.options[0]} ${counts[0]} — ${caseFile.options[1]} ${counts[1]}.

This is what each of them found, and the argument each of them gave.

${voices}`;
}

/**
 * The charge that goes with the polled room.
 *
 * The wording works hard against mere conformity, because the naive version of
 * this reliably produces it: told only that eleven jurors disagree, models fold.
 * What is worth measuring is whether an *argument* moves them, so the count is
 * named as explicitly not being a reason.
 *
 * A decision carries one extra warning. Jurors drawing on their own knowledge
 * produce confident specifics, and round two is where one juror's invented
 * figure would otherwise spread through the whole room unchallenged.
 */
function reconsiderCharge(caseFile: CaseFile): string {
  const decision = caseMode(caseFile.mode) === "decision";

  return `You have now heard the room. You are asked once more for your finding.

How to weigh what you have just read:
- A count is not ${decision ? "an argument" : "evidence"}. That the others landed elsewhere is not, by itself, a reason to move. ${
    decision
      ? "A juror who names something you had not weighed is."
      : "An argument that shows you misread the record is."
  }
- Change your finding only if a juror has named ${
    decision
      ? "a consideration you had not weighed, something about these options you did not know"
      : "a fact you overlooked, a reading of the evidence you had not considered"
  }, or an error in your own reasoning. If that has happened, say so plainly and say who.
- Otherwise hold, and name the thing you are holding against — the point that was put to you and did not survive ${
    decision ? "a second look" : "contact with the file"
  }.
- You may keep your finding and move your confidence, up or down. Hearing a good argument you can answer is a reason to be more sure, not less.
- Do not split the difference, do not soften your rationale to be agreeable, and do not move to make the room tidy. A jury that converges because it wants to agree has decided nothing.${
    decision
      ? `
- Treat another juror's confident specific with the same care you would want applied to your own. If someone has asserted a figure or a fact you have reason to doubt, say so rather than quietly adopting it.`
      : ""
  }

Return the same JSON as before — finding, confidence, rationale, sticking_point — with the rationale now saying, in your own voice, whether anything moved you and what it was, or that nothing did.`;
}

/**
 * Ask one juror to reconsider, having heard everyone else.
 *
 * This is the round the whole app is for. The juror's first finding is replayed
 * as their own previous turn, then the polled room is put to them — so a model
 * that changes its mind is genuinely revising a position it held, not scoring a
 * fresh case that happens to come with opinions attached.
 */
export async function requestReconsideration(
  juror: Juror,
  caseFile: CaseFile,
  own: JurorVerdict,
  room: { juror: Juror; position: RoomPosition }[],
  bench: number,
  instruction?: string,
  abort?: AbortSignal,
): Promise<JurorVerdict> {
  try {
    return await attemptReconsideration(juror, caseFile, own, room, bench, instruction, abort);
  } catch (err) {
    if (err instanceof JurorError && err.retryable) {
      await pause();
      if (abort?.aborted) throw new CancelledError();
      return attemptReconsideration(juror, caseFile, own, room, bench, instruction, abort);
    }
    throw err;
  }
}

async function attemptReconsideration(
  juror: Juror,
  caseFile: CaseFile,
  own: JurorVerdict,
  room: { juror: Juror; position: RoomPosition }[],
  bench: number,
  instruction?: string,
  abort?: AbortSignal,
): Promise<JurorVerdict> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new JurorError("OPENROUTER_API_KEY is not set.");

  const model = modelFor(juror.id);
  if (!model) throw new JurorError(`No model assigned to seat ${juror.seat}.`);

  // The second round carries the whole room on top of the case, so a juror who
  // could read the file alone may still not be able to read it with everyone
  // else's argument attached.
  assertReadable(juror, caseFile, instruction, roomTokens(room.map((r) => r.position)));

  const startedAt = Date.now();

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      signal: deadline(abort),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.OPENROUTER_SITE_URL ?? "http://localhost:3000",
        "X-Title": "Jury of Peers",
      },
      body: JSON.stringify({
        model: model.slug,
        max_tokens: 1500,
        messages: [
          { role: "system", content: systemPrompt(juror, caseFile, bench, instruction) },
          { role: "user", content: userPrompt(caseFile) },
          ownTurn(caseFile, own),
          { role: "user", content: `${roomReport(caseFile, room)}\n\n${reconsiderCharge(caseFile)}` },
        ],
        response_format: { type: "json_schema", json_schema: schema(caseFile) },
        provider: { require_parameters: true },
        ...(model.reasoning === "off"
          ? { reasoning: { enabled: false } }
          : model.reasoning === "low"
            ? { reasoning: { effort: "low" } }
            : {}),
      }),
    });
  } catch (err) {
    classify(err, model, abort);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new JurorError(
      `${model.label} returned ${res.status}. ${extractError(detail)}`.trim(),
      res.status === 429 || res.status >= 500,
    );
  }

  const body = (await res.json()) as {
    choices?: { message?: { content?: string }; finish_reason?: string }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    model?: string;
    provider?: string;
    error?: { message?: string };
  };

  if (body.error) throw new JurorError(`${model.label}: ${body.error.message ?? "upstream error"}`);

  const choice = body.choices?.[0];
  const content = choice?.message?.content;
  if (!content?.trim()) {
    throw new JurorError(
      choice?.finish_reason === "length"
        ? `${model.label} ran out of tokens before answering.`
        : `${model.label} returned an empty finding.`,
      true,
    );
  }

  const parsed = parseVerdict(content, caseFile);
  const promptTokens = body.usage?.prompt_tokens ?? 0;
  const completionTokens = body.usage?.completion_tokens ?? 0;

  return {
    jurorId: juror.id,
    ...parsed,
    deliberationMs: Date.now() - startedAt,
    source: "live",
    round: 2,
    model: body.model ?? model.slug,
    provider: body.provider,
    usage: {
      promptTokens,
      completionTokens,
      costUsd: costOf(juror.id, promptTokens, completionTokens),
    },
  };
}

export const DEFAULT_QUESTION =
  "Explain your reasoning in full. Walk through what you actually weighed, which pieces of evidence carried the most weight and why, what gave you pause, and what would have changed your mind.";

/**
 * Put a follow-up question to a juror who has already returned a finding.
 *
 * The juror's own verdict is replayed back as their previous turn, so the model
 * is genuinely continuing its own reasoning rather than reconstructing a
 * position it never held. Prose this time — no schema, because the answer is
 * for a person to read.
 */
export async function requestExplanation(
  juror: Juror,
  caseFile: CaseFile,
  verdict: JurorVerdict,
  bench: number,
  instruction?: string,
  question?: string,
  abort?: AbortSignal,
): Promise<{ text: string; usage: { promptTokens: number; completionTokens: number } }> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new JurorError("OPENROUTER_API_KEY is not set.");

  const model = modelFor(juror.id);
  if (!model) throw new JurorError(`No model assigned to seat ${juror.seat}.`);

  const asked = question?.trim() || DEFAULT_QUESTION;

  // Their first answer and the question go on top of the case, so this is the
  // longer prompt of the two even though the reply is shorter.
  assertReadable(
    juror,
    caseFile,
    instruction,
    estimateTokens(verdict.rationale) + estimateTokens(asked) + 120,
  );

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      signal: deadline(abort),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.OPENROUTER_SITE_URL ?? "http://localhost:3000",
        "X-Title": "Jury of Peers",
      },
      body: JSON.stringify({
        model: model.slug,
        max_tokens: 1200,
        messages: [
          { role: "system", content: systemPrompt(juror, caseFile, bench, instruction) },
          { role: "user", content: userPrompt(caseFile) },
          // Their own answer, replayed so the follow-up continues it.
          ownTurn(caseFile, verdict),
          {
            role: "user",
            content: `${asked}

Answer as this juror, in plain prose — no JSON, no headings, no bullet points. Two to four short paragraphs. Stay with the finding you gave${
              caseMode(caseFile.mode) === "decision"
                ? ". You may draw on what you know as well as the brief, but keep saying which is which, and do not invent a specific to make a point land"
                : " and the evidence in the case file"
            }; if the honest answer is that something is genuinely uncertain, say so.`,
          },
        ],
        ...(model.reasoning === "off"
          ? { reasoning: { enabled: false } }
          : model.reasoning === "low"
            ? { reasoning: { effort: "low" } }
            : {}),
      }),
    });
  } catch (err) {
    classify(err, model, abort);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new JurorError(
      `${model.label} returned ${res.status}. ${extractError(detail)}`.trim(),
      res.status === 429 || res.status >= 500,
    );
  }

  const body = (await res.json()) as {
    choices?: { message?: { content?: string }; finish_reason?: string }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    error?: { message?: string };
  };

  if (body.error) throw new JurorError(`${model.label}: ${body.error.message ?? "upstream error"}`);

  const text = body.choices?.[0]?.message?.content?.trim();
  if (!text) throw new JurorError(`${model.label} had nothing further to say.`, true);

  return {
    text,
    usage: {
      promptTokens: body.usage?.prompt_tokens ?? 0,
      completionTokens: body.usage?.completion_tokens ?? 0,
    },
  };
}

interface ParsedVerdict {
  choice: VerdictChoice;
  confidence: number;
  rationale: string;
  pivot: string;
}

/**
 * Read the model's JSON leniently. `response_format` is honoured by every model
 * in the roster, but a stray code fence or a preamble sentence is cheap to
 * survive and expensive to be defeated by.
 */
export function parseVerdict(raw: string, caseFile: CaseFile): ParsedVerdict {
  const json = extractJson(raw);
  if (!json) throw new JurorError("The finding could not be read as JSON.", true);

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(json) as Record<string, unknown>;
  } catch {
    throw new JurorError("The finding was not valid JSON.", true);
  }

  const finding = String(data.finding ?? data.verdict ?? "").trim();
  const choice = matchOption(finding, caseFile);
  if (choice === undefined) {
    throw new JurorError(`"${finding || "(nothing)"}" is not one of the two findings.`, true);
  }

  let confidence = Number(data.confidence);
  if (!Number.isFinite(confidence)) confidence = 0.7;
  if (confidence > 1) confidence /= 100; // some models answer 0–100
  confidence = Math.min(0.99, Math.max(0.5, confidence));

  const rationale = String(data.rationale ?? "").trim() || "This juror gave no reasoning.";
  const pivot = String(data.sticking_point ?? data.pivot ?? "").trim() || "the evidence as a whole";

  return { choice, confidence, rationale, pivot };
}

function matchOption(finding: string, caseFile: CaseFile): VerdictChoice | undefined {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const target = norm(finding);
  if (!target) return undefined;

  const options = caseFile.options.map(norm);
  const exact = options.indexOf(target);
  if (exact !== -1) return exact as VerdictChoice;

  // "Not guilty" contains "guilty", so prefer the longer match when both hit.
  const hits = options
    .map((o, i) => ({ i, len: o.length, hit: o && (target.includes(o) || o.includes(target)) }))
    .filter((h) => h.hit)
    .sort((a, b) => b.len - a.len);

  return hits.length ? (hits[0].i as VerdictChoice) : undefined;
}

/** Pull the first balanced JSON object out of a response. */
function extractJson(raw: string): string | undefined {
  const text = raw.replace(/```(?:json)?/gi, "").trim();
  const start = text.indexOf("{");
  if (start === -1) return undefined;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') inString = !inString;
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  return undefined;
}

function extractError(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    return parsed.error?.message ?? "";
  } catch {
    return body.slice(0, 160);
  }
}
