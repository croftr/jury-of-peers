/**
 * Model assignment for the twelve seats.
 *
 * Twelve models from twelve different labs, chosen so the jury's disagreement
 * is real rather than one model arguing with itself. All are cheap, fast, and
 * support structured JSON output. Slugs and prices verified against
 * https://openrouter.ai/api/v1/models — re-check before changing one.
 */
/**
 * How to handle a model's internal reasoning.
 *
 * A juror's reasoning belongs in its `rationale`, not in a hidden channel we
 * pay for and discard — and models left to reason freely spend the whole token
 * budget thinking, then return empty or truncated JSON.
 *
 *   "off"  — reasoning-capable, and willing to switch it off.
 *   "low"  — reasoning is mandatory (GPT-5 mini rejects the off switch with a
 *            400), so ask for the shallowest setting instead.
 *   undefined — not a reasoning model; send nothing.
 *
 * Each value below was established by calling the model, not by assumption.
 */
export type ReasoningPolicy = "off" | "low";

export interface JurorModel {
  /** OpenRouter slug. */
  slug: string;
  /** Short label for the UI. */
  label: string;
  lab: string;
  /** USD per million tokens, for the running cost estimate. */
  inPerM: number;
  outPerM: number;
  reasoning?: ReasoningPolicy;
  /** Context window in tokens — the ceiling on how large a case file can be. */
  context: number;
}

export const JUROR_MODELS: Record<number, JurorModel> = {
  1: { slug: "anthropic/claude-haiku-4.5", label: "Claude Haiku 4.5", lab: "Anthropic", inPerM: 1.0, outPerM: 5.0, reasoning: "off", context: 200000 },
  2: { slug: "openai/gpt-5-mini", label: "GPT-5 mini", lab: "OpenAI", inPerM: 0.25, outPerM: 2.0, reasoning: "low", context: 400000 },
  3: { slug: "google/gemini-3.1-flash-lite", label: "Gemini 3.1 Flash Lite", lab: "Google", inPerM: 0.25, outPerM: 1.5, reasoning: "off", context: 1048576 },
  4: { slug: "deepseek/deepseek-v4-flash", label: "DeepSeek V4 Flash", lab: "DeepSeek", inPerM: 0.14, outPerM: 0.28, reasoning: "off", context: 1048576 },
  5: { slug: "qwen/qwen3.5-flash-02-23", label: "Qwen3.5 Flash", lab: "Alibaba", inPerM: 0.065, outPerM: 0.26, reasoning: "off", context: 1000000 },
  6: { slug: "mistralai/mistral-small-3.2-24b-instruct", label: "Mistral Small 3.2", lab: "Mistral", inPerM: 0.094, outPerM: 0.25, context: 256000 },
  7: { slug: "meta-llama/llama-4-scout", label: "Llama 4 Scout", lab: "Meta", inPerM: 0.1, outPerM: 0.3, context: 1310720 },
  8: { slug: "z-ai/glm-4.7-flash", label: "GLM 4.7 Flash", lab: "Z.ai", inPerM: 0.06, outPerM: 0.4, reasoning: "off", context: 202752 },
  9: { slug: "microsoft/phi-4", label: "Phi-4", lab: "Microsoft", inPerM: 0.07, outPerM: 0.14, context: 16384 },
  10: { slug: "cohere/command-r7b-12-2024", label: "Command R7B", lab: "Cohere", inPerM: 0.037, outPerM: 0.15, context: 128000 },
  11: { slug: "nvidia/nemotron-3.5-lightning", label: "Nemotron 3.5 Lightning", lab: "NVIDIA", inPerM: 0.1, outPerM: 0.25, reasoning: "off", context: 1000000 },
  12: { slug: "upstage/solar-pro4", label: "Solar Pro 4", lab: "Upstage", inPerM: 0.03, outPerM: 0.12, reasoning: "off", context: 524288 },
};

export function modelFor(jurorId: number): JurorModel | undefined {
  return JUROR_MODELS[jurorId];
}

/** Cost of one juror's call, in USD, from its own model's rates. */
export function costOf(jurorId: number, promptTokens: number, completionTokens: number): number | undefined {
  const m = modelFor(jurorId);
  if (!m) return undefined;
  return (promptTokens * m.inPerM + completionTokens * m.outPerM) / 1_000_000;
}
