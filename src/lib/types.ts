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
  /**
   * Which time of asking produced this finding. 1 is the first, silent round;
   * 2 is after the room was polled and the juror heard everyone else. Absent
   * means the first — every verdict written before there was a second round.
   */
  round?: 1 | 2;
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

/**
 * One other juror's first-round position, as it is put to the room in the
 * second. Deliberately not a `JurorVerdict`: a juror weighing what the room
 * said has no business seeing which model said it, how long it took, or what
 * it cost — only the finding and the argument for it.
 */
export interface RoomPosition {
  jurorId: number;
  choice: VerdictChoice;
  confidence: number;
  rationale: string;
  pivot: string;
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

/**
 * A completed case, written to the archive once the room has spoken.
 *
 * Self-contained on purpose: the bench and its standing instructions are
 * snapshotted rather than referenced, so a case decided today still replays
 * correctly after the juror roster or the model line-up changes.
 */
export interface ArchivedCase {
  id: string;
  /** ISO 8601, set by the server so the clock is the same for every record. */
  savedAt: string;
  caseFile: CaseFile;
  /** The bench as it stood, in seat order. */
  jurors: Juror[];
  /** Standing instructions the case ran under, keyed by juror id. */
  instructions: Record<number, string>;
  verdicts: JurorVerdict[];
  /**
   * The findings as they stood before the room went back out, present only on
   * cases that were deliberated twice. `verdicts` always holds where the jury
   * finally landed, so everything that reads a case can ignore this.
   */
  firstRound?: JurorVerdict[];
  /**
   * The case this one was a retrial of, if it was. A retrial is a new record —
   * it was a different jury on a different day — but the lineage is kept so the
   * two can be read against each other.
   */
  retrialOf?: string;
  failures: JurorFailure[];
  tally: Tally;
}

/**
 * How one juror came down on one case.
 *
 * Kept in the summary rather than only in the full record, so the juror record
 * can be computed across the whole archive without reading every case file —
 * which is the difference between a page that loads and one that does not.
 */
export interface SummaryFinding {
  jurorId: number;
  choice: VerdictChoice;
  confidence: number;
  /** Present only when this juror changed their finding in the second round. */
  moved?: boolean;
}

/** The one-line view of a case, kept beside it so the list page reads cheaply. */
export interface CaseSummary {
  id: string;
  savedAt: string;
  title: string;
  /** How many jurors returned a finding — the count the verdict actually rests on. */
  jurorCount: number;
  /** How many seats were empanelled. Differs from jurorCount when a model failed. */
  benchSize: number;
  /** The headline finding: an option label, or "Hung jury". */
  verdict: string;
  /** e.g. "8–4", majority first. */
  split: string;
  hung: boolean;
  majority: VerdictChoice;
  /** How many times the room was asked. Absent on cases filed before round two existed. */
  rounds?: 1 | 2;
  /** How many jurors changed their finding in the second round. */
  moved?: number;
  /**
   * Every juror who returned a finding, and what they found. Absent on cases
   * filed before the juror record existed — the record page says so rather than
   * quietly counting a smaller archive than the one on screen.
   */
  findings?: SummaryFinding[];
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
