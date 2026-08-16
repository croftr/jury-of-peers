import { getJuror } from "./jurors";
import type { CaseFile, JurorVerdict, RoomPosition, Tally, VerdictChoice } from "./types";

/**
 * STUB ENGINE.
 *
 * Every juror will eventually be an LLM agent reached over the network. Until
 * then this produces a plausible, *deterministic* verdict: the same case text
 * always yields the same jury, so the UI can be reasoned about while the real
 * agents are plumbed in behind the same signature.
 */

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 */
function rng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const OPENERS = [
  "Taking the record as a whole",
  "Setting the rhetoric aside",
  "On the evidence actually before us",
  "Reading the exhibits against the testimony",
  "Weighing what was proved against what was merely asserted",
  "After walking the timeline twice",
];

const FOR = [
  "the account holds together at every point where it could have failed",
  "the corroboration is independent, and independent corroboration is hard to fake",
  "the alternative explanation requires a chain of coincidences I cannot accept",
  "the documentary record is consistent and nobody has offered a reason to doubt it",
  "the physical evidence points one way and nothing pulls against it",
];

const AGAINST = [
  "the case rests on inference where it needed proof",
  "there is a gap in the chain that no witness closed",
  "the strongest evidence is also the evidence most easily explained another way",
  "certainty was asserted far past the point the material supports it",
  "at least one innocent reading survives, and that is enough",
];

const PIVOTS = [
  "the burden of proof",
  "the missing interval",
  "the chain of custody",
  "the witness's revision",
  "the timestamp discrepancy",
  "the absence of motive",
  "the corroborating document",
  "the unexplained coincidence",
  "the standard of care",
  "the contradiction in the record",
];

/** Decide one juror's verdict. Swap this body for an agent call. */
export function stubVerdict(jurorId: number, caseFile: CaseFile): JurorVerdict {
  const juror = getJuror(jurorId);
  if (!juror) throw new Error(`No juror with id ${jurorId}`);

  const seed = hash(`${caseFile.title}::${caseFile.evidence}::${jurorId}`);
  const rand = rng(seed);

  // Each case has its own "true" lean; jurors read it through their disposition.
  // Most cases genuinely point one way, and a case with a real lean pulls all
  // but the most contrary jurors with it — so pull the lean away from dead
  // centre. Truly balanced cases (and hung juries) stay rare but possible.
  const raw = rng(hash(caseFile.evidence || caseFile.title))() - 0.5;
  const caseLean = Math.sign(raw) * (0.25 + Math.abs(raw) * 2.7);
  const score = caseLean + juror.bias * 0.8 + (rand() - 0.5) * 0.7;
  const choice: VerdictChoice = score >= 0 ? 0 : 1;

  const confidence = Math.min(0.98, 0.52 + Math.abs(score) * 0.42 + rand() * 0.08);
  const support = choice === 0 ? FOR : AGAINST;
  const rationale =
    `${OPENERS[Math.floor(rand() * OPENERS.length)]}, ` +
    `${support[Math.floor(rand() * support.length)]}. ` +
    `As a ${juror.archetype.toLowerCase()} reader of the file, I return ${caseFile.options[choice]}.`;

  return {
    jurorId,
    choice,
    confidence,
    rationale,
    pivot: PIVOTS[Math.floor(rand() * PIVOTS.length)],
    deliberationMs: Math.round(1400 + rand() * 5200),
    source: "simulated",
    round: 1,
  };
}

const HELD = [
  "Nothing said across the table touched the thing this turns on",
  "I have heard the room and I am where I was",
  "The arguments against were put well and they were still arguments, not evidence",
  "I looked again at what they pointed to and it says what I thought it said",
];

const MOVED = [
  "Seat by seat they kept returning to a point I had read past",
  "I had the sequence wrong, and the room was right to say so",
  "What I took for a gap was answered in the file — I simply had not joined it up",
  "Put the way it was put to me, my own reasoning stopped holding",
];

/**
 * Decide one juror's second-round verdict, offline.
 *
 * Deterministic like the first round, and deliberately *sticky*: the room's
 * count on its own never moves anyone. What moves a juror here is being both
 * unsure and heavily outnumbered — which is the shape of the thing the real
 * second round is built to detect, so the stub exercises the same UI states.
 */
export function stubReconsideration(
  jurorId: number,
  caseFile: CaseFile,
  own: JurorVerdict,
  room: RoomPosition[],
): JurorVerdict {
  const juror = getJuror(jurorId);
  if (!juror) throw new Error(`No juror with id ${jurorId}`);

  const rand = rng(hash(`${caseFile.title}::${caseFile.evidence}::${jurorId}::round2`));

  const against = room.filter((p) => p.choice !== own.choice).length;
  const share = room.length ? against / room.length : 0;

  // Doubt is what opens the door; the size of the crowd only decides how wide.
  // A juror at 0.95 stays put in front of a unanimous room; one at 0.55 facing
  // ten the other way is genuinely reconsidering.
  const pull = Math.max(0, share - 0.5) * (1 - own.confidence) * 2.4;
  const moved = room.length > 0 && rand() < pull;

  const choice: VerdictChoice = moved ? ((own.choice === 0 ? 1 : 0) as VerdictChoice) : own.choice;
  // Moving costs conviction; holding through the room's argument earns a little.
  const confidence = moved
    ? Math.min(0.9, Math.max(0.5, own.confidence * 0.82 + rand() * 0.06))
    : Math.min(0.98, own.confidence + (1 - share) * 0.05 + rand() * 0.03);

  const opener = moved
    ? MOVED[Math.floor(rand() * MOVED.length)]
    : HELD[Math.floor(rand() * HELD.length)];

  return {
    jurorId,
    choice,
    confidence,
    rationale: `${opener}. I return ${caseFile.options[choice]}.`,
    pivot: moved ? PIVOTS[Math.floor(rand() * PIVOTS.length)] : own.pivot,
    deliberationMs: Math.round(1100 + rand() * 4200),
    source: "simulated",
    round: 2,
  };
}

export function tally(verdicts: JurorVerdict[]): Tally {
  const counts: [number, number] = [0, 0];
  for (const v of verdicts) counts[v.choice]++;

  const majority: VerdictChoice = counts[0] >= counts[1] ? 0 : 1;
  const inMajority = verdicts.filter((v) => v.choice === majority);
  const strength = inMajority.length
    ? inMajority.reduce((s, v) => s + v.confidence, 0) / inMajority.length
    : 0;

  return {
    counts,
    majority,
    unanimous: counts[majority] === verdicts.length && verdicts.length > 0,
    // Only a dead-even room is deadlocked. Anything else returns a majority,
    // with the split reported so a narrow win reads as a narrow win.
    hung: verdicts.length > 0 && counts[0] === counts[1],
    strength,
    margin: Math.abs(counts[0] - counts[1]),
  };
}
