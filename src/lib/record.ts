import type { CaseSummary, VerdictChoice } from "./types";

/**
 * What the archive says about the jurors, read across every case in it.
 *
 * The app has been keeping this data since the first verdict and never looked
 * at it. One case tells you what twelve models thought of one matter; forty
 * cases tell you which of them dissents, which of them can be moved, and whose
 * confidence is worth anything — which is the more interesting question, and
 * the one nothing else can answer.
 *
 * Everything is computed from summaries. The full records are far larger and
 * say nothing extra that a juror's record needs.
 */

export interface JurorRecord {
  jurorId: number;
  /** Cases where this juror returned a finding. Empty seats are not sat. */
  sat: number;
  /** Cases where their finding was not the room's. */
  dissents: number;
  /** Cases where the room was unanimous *because* of them — everyone agreed. */
  withUnanimous: number;
  /** Times they changed their finding in a second round. */
  moved: number;
  /** Cases they sat on that were heard twice — the chances they had to move. */
  couldMove: number;
  /** Mean confidence across every finding they gave. */
  confidence: number;
  /** Mean confidence on the cases where they turned out to be in the minority. */
  confidenceWhenDissenting: number;
}

export interface Agreement {
  a: number;
  b: number;
  /** Cases both sat on. */
  together: number;
  /** Of those, how many they landed on the same side of. */
  agreed: number;
}

export interface ArchiveRecord {
  /** Cases that carry per-juror findings, and so could be counted. */
  counted: number;
  /** Cases in the archive that predate the record and were skipped. */
  skipped: number;
  jurors: JurorRecord[];
  agreements: Agreement[];
  /** Cases the room split on at all — the ones where any of this is interesting. */
  contested: number;
  unanimous: number;
  hung: number;
}

/** The majority a summary landed on, or null when the room was tied. */
function majorityOf(summary: CaseSummary): VerdictChoice | null {
  return summary.hung ? null : summary.majority;
}

export function buildRecord(summaries: CaseSummary[]): ArchiveRecord {
  const usable = summaries.filter((s) => s.findings?.length);

  const rows = new Map<number, JurorRecord>();
  const confidences = new Map<number, number[]>();
  const dissentConfidences = new Map<number, number[]>();
  const pairs = new Map<string, Agreement>();

  let unanimous = 0;
  let hung = 0;

  const row = (jurorId: number): JurorRecord => {
    let existing = rows.get(jurorId);
    if (!existing) {
      existing = {
        jurorId,
        sat: 0,
        dissents: 0,
        withUnanimous: 0,
        moved: 0,
        couldMove: 0,
        confidence: 0,
        confidenceWhenDissenting: 0,
      };
      rows.set(jurorId, existing);
    }
    return existing;
  };

  for (const summary of usable) {
    const findings = summary.findings!;
    const majority = majorityOf(summary);
    const allAgreed = findings.length > 1 && findings.every((f) => f.choice === findings[0].choice);

    if (summary.hung) hung += 1;
    else if (allAgreed) unanimous += 1;

    for (const finding of findings) {
      const r = row(finding.jurorId);
      r.sat += 1;
      if (allAgreed) r.withUnanimous += 1;
      // A hung room has no majority to dissent from, so nobody dissented.
      if (majority !== null && finding.choice !== majority) {
        r.dissents += 1;
        (dissentConfidences.get(finding.jurorId) ?? setList(dissentConfidences, finding.jurorId)).push(
          finding.confidence,
        );
      }
      if (summary.rounds === 2) {
        r.couldMove += 1;
        if (finding.moved) r.moved += 1;
      }
      (confidences.get(finding.jurorId) ?? setList(confidences, finding.jurorId)).push(
        finding.confidence,
      );
    }

    // Every pair that sat together, and whether they landed the same way. The
    // key is ordered so a pair is counted once however the seats are iterated.
    for (let i = 0; i < findings.length; i++) {
      for (let j = i + 1; j < findings.length; j++) {
        const [a, b] =
          findings[i].jurorId < findings[j].jurorId
            ? [findings[i], findings[j]]
            : [findings[j], findings[i]];
        const key = `${a.jurorId}:${b.jurorId}`;
        const pair = pairs.get(key) ?? { a: a.jurorId, b: b.jurorId, together: 0, agreed: 0 };
        pair.together += 1;
        if (a.choice === b.choice) pair.agreed += 1;
        pairs.set(key, pair);
      }
    }
  }

  for (const r of rows.values()) {
    r.confidence = mean(confidences.get(r.jurorId) ?? []);
    r.confidenceWhenDissenting = mean(dissentConfidences.get(r.jurorId) ?? []);
  }

  return {
    counted: usable.length,
    skipped: summaries.length - usable.length,
    jurors: [...rows.values()].sort((a, b) => a.jurorId - b.jurorId),
    agreements: [...pairs.values()],
    contested: usable.length - unanimous - hung,
    unanimous,
    hung,
  };
}

function setList(map: Map<number, number[]>, key: number): number[] {
  const list: number[] = [];
  map.set(key, list);
  return list;
}

function mean(values: number[]): number {
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
}
