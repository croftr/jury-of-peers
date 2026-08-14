export type VerdictChoice = 0 | 1;

/** A case can be a criminal trial, a civil dispute, a debate — anything with two sides. */
export interface CaseFile {
  title: string;
  /** Free-form case details, evidence, exhibits, testimony. */
  evidence: string;
  /** The two possible findings, e.g. ["Guilty", "Not guilty"]. */
  options: [string, string];
}

export interface AvatarSpec {
  skin: string;
  hair: string;
  hairStyle: number;
  garment: string;
  accent: string;
  glasses: boolean;
  facialHair: boolean;
  earrings: boolean;
}

export interface Juror {
  id: number;
  /** Jurors are anonymous in the box — they are known by seat and disposition. */
  seat: string;
  alias: string;
  archetype: string;
  disposition: string;
  /** -1 = leans toward option[1], +1 = leans toward option[0]. Used by the stub engine. */
  bias: number;
  avatar: AvatarSpec;
}

export interface JurorVerdict {
  jurorId: number;
  choice: VerdictChoice;
  /** 0..1 — how sure this juror is. */
  confidence: number;
  rationale: string;
  /** Key phrase the juror kept returning to during deliberation. */
  pivot: string;
  /** Wall-clock time this juror took to decide, in ms. */
  deliberationMs: number;
  /** Where the verdict came from: a real model, or the offline stub engine. */
  source: "live" | "simulated";
  /** The model that actually served the request, as the API reported it. */
  model?: string;
  /** Which upstream host served it, e.g. "Groq". Varies run to run. */
  provider?: string;
  usage?: { promptTokens: number; completionTokens: number; costUsd?: number };
}

/** A juror the panel could not reach — surfaced rather than silently faked. */
export interface JurorFailure {
  jurorId: number;
  message: string;
}

/** A juror's fuller account of their finding, asked for after the verdict. */
export interface JurorExplanation {
  jurorId: number;
  /** The question put to them — the default one, or the user's own. */
  question: string;
  text: string;
  source: "live" | "simulated";
  usage?: { promptTokens: number; completionTokens: number; costUsd?: number };
}

export interface Tally {
  counts: [number, number];
  majority: VerdictChoice;
  unanimous: boolean;
  hung: boolean;
  /** Mean confidence of the jurors in the majority. */
  strength: number;
  margin: number;
}
