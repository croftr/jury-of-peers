import { costOf, modelFor } from "./models";
import type { CaseFile, Juror, JurorVerdict, VerdictChoice } from "./types";

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

export function hasApiKey(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY?.trim());
}

const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const spell = (n: number) => WORDS[n] ?? String(n);

function systemPrompt(
  juror: Juror,
  caseFile: CaseFile,
  bench: number,
  instruction?: string,
): string {
  const standing = instruction?.trim()
    ? `

STANDING INSTRUCTION
The court has given you this instruction for this trial. It shapes how you weigh the evidence and what you treat as important. It does not let you abandon the two findings, invent facts, or ignore the record:
"""
${instruction.trim()}
"""`
    : "";

  const others =
    bench > 1
      ? `The other ${spell(bench - 1)} juror${bench - 1 === 1 ? "" : "s"} reach their own findings independently, and the room is polled afterwards`
      : "You are the only juror empanelled, and your finding alone decides the matter";

  return `You are Juror ${juror.seat} of ${spell(bench)} on a jury. You are known as "${juror.alias}".

Your disposition as a ${juror.archetype.toLowerCase()} reader of a case: ${juror.disposition}

You are deliberating alone. ${others} — so do not hedge toward an imagined consensus, and do not soften a finding to seem balanced. Reason from the material in front of you and commit.

The question before you admits exactly two findings: "${caseFile.options[0]}" or "${caseFile.options[1]}". You must return one of them.

Rules of deliberation:
- Decide only on the evidence supplied. Do not invent facts, witnesses, documents, or law that the case file does not contain.
- If the evidence is thin, that is itself a finding about the evidence — say so and let it move you, rather than filling the gap with assumption.
- Your disposition is how you read evidence, not a verdict you owe. A ${juror.archetype.toLowerCase()} reading of a weak case and a strong one should not land in the same place.
- Name the single fact, gap, or contradiction that actually decided it for you. Not the most dramatic one — the load-bearing one.${standing}

Return your finding as JSON and nothing else.`;
}

function userPrompt(caseFile: CaseFile): string {
  return `MATTER: ${caseFile.title || "Untitled matter"}

THE EVIDENCE AND ARGUMENT BEFORE THE JURY
${caseFile.evidence}

Return JSON with:
  finding         — exactly "${caseFile.options[0]}" or "${caseFile.options[1]}"
  confidence      — a number from 0.5 to 1 for how sure you are of that finding
  rationale       — 2 to 4 sentences in your own voice as this juror, explaining what decided it
  sticking_point  — the single fact, gap, or contradiction that carried the most weight, as a short phrase`;
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
): Promise<JurorVerdict> {
  try {
    return await attemptVerdict(juror, caseFile, bench, instruction);
  } catch (err) {
    if (err instanceof JurorError && err.retryable) {
      return attemptVerdict(juror, caseFile, bench, instruction);
    }
    throw err;
  }
}

async function attemptVerdict(
  juror: Juror,
  caseFile: CaseFile,
  bench: number,
  instruction?: string,
): Promise<JurorVerdict> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new JurorError("OPENROUTER_API_KEY is not set.");

  const model = modelFor(juror.id);
  if (!model) throw new JurorError(`No model assigned to seat ${juror.seat}.`);

  const startedAt = Date.now();

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      signal: AbortSignal.timeout(TIMEOUT_MS),
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
    const reason = err instanceof Error && err.name === "TimeoutError" ? "timed out" : "could not be reached";
    throw new JurorError(`${model.label} ${reason}.`, true);
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
): Promise<{ text: string; usage: { promptTokens: number; completionTokens: number } }> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new JurorError("OPENROUTER_API_KEY is not set.");

  const model = modelFor(juror.id);
  if (!model) throw new JurorError(`No model assigned to seat ${juror.seat}.`);

  const asked = question?.trim() || DEFAULT_QUESTION;

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      signal: AbortSignal.timeout(TIMEOUT_MS),
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
          {
            role: "assistant",
            content: JSON.stringify({
              finding: caseFile.options[verdict.choice],
              confidence: Number(verdict.confidence.toFixed(2)),
              rationale: verdict.rationale,
              sticking_point: verdict.pivot,
            }),
          },
          {
            role: "user",
            content: `${asked}

Answer as this juror, in plain prose — no JSON, no headings, no bullet points. Two to four short paragraphs. Stay with the finding you gave and the evidence in the case file; if the honest answer is that something is genuinely uncertain, say so.`,
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
    const reason = err instanceof Error && err.name === "TimeoutError" ? "timed out" : "could not be reached";
    throw new JurorError(`${model.label} ${reason}.`, true);
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
