"use client";

import Link from "next/link";
import { useMemo } from "react";
import { tally as computeTally } from "@/lib/deliberate";
import type { ArchivedCase, CaseFile, Juror, JurorVerdict, Tally } from "@/lib/types";

/**
 * The same case, twice, by two juries.
 *
 * Round two asks whether an argument moves a juror. A retrial asks a different
 * question — whether the *finding* was ever about the case at all, or about who
 * happened to be in the box. Reading the two side by side is the only way to
 * tell, which is why the archive keeps the bench and the instructions with each
 * record rather than referencing them.
 */
export default function RetrialComparison({
  prior,
  caseFile,
  jurors,
  tally,
  verdicts,
  onSelect,
}: {
  prior: ArchivedCase;
  caseFile: CaseFile;
  /** The bench that just sat. */
  jurors: Juror[];
  tally: Tally;
  verdicts: JurorVerdict[];
  onSelect: (jurorId: number) => void;
}) {
  const priorTally = prior.tally ?? computeTally(prior.verdicts);

  const view = useMemo(() => {
    const before = new Map(prior.verdicts.map((v) => [v.jurorId, v]));
    const now = new Map(verdicts.map((v) => [v.jurorId, v]));

    // Only jurors who returned a finding *both* times can be said to have
    // changed their mind. The rest are a difference in the bench, not the room.
    const both = jurors.filter((j) => before.has(j.id) && now.has(j.id));
    const turned = both.filter((j) => before.get(j.id)!.choice !== now.get(j.id)!.choice);

    const priorSeats = new Set(prior.jurors.map((j) => j.id));
    const nowSeats = new Set(jurors.map((j) => j.id));

    return {
      before,
      turned,
      steady: both.length - turned.length,
      added: jurors.filter((j) => !priorSeats.has(j.id)),
      dropped: prior.jurors.filter((j) => !nowSeats.has(j.id)),
    };
  }, [prior, jurors, verdicts]);

  // The two juries were asked the same question only if the findings were
  // labelled the same way. If they were reworded, say so instead of pretending
  // "option 0" means the same thing in both records.
  const sameQuestion =
    prior.caseFile.options[0] === caseFile.options[0] &&
    prior.caseFile.options[1] === caseFile.options[1];

  const label = (t: Tally, file: CaseFile) => (t.hung ? "Hung jury" : file.options[t.majority]);
  const split = (t: Tally) => `${t.counts[t.majority]}–${t.counts[t.majority === 0 ? 1 : 0]}`;
  const toneOf = (t: Tally) =>
    t.hung ? "var(--brass)" : t.majority === 0 ? "var(--for)" : "var(--against)";

  const changed =
    sameQuestion &&
    (priorTally.hung !== tally.hung || (!tally.hung && priorTally.majority !== tally.majority));

  const heardOn = new Date(prior.savedAt);

  return (
    <section className="panel rounded-2xl overflow-hidden mt-6">
      <div className="px-6 sm:px-8 py-5 border-b border-white/8">
        <p className="mono text-[10px] tracking-[0.28em] uppercase text-brass/70">Retrial</p>
        <p className="display text-xl sm:text-2xl mt-1.5 leading-snug">
          {!sameQuestion ? (
            <>
              Heard before, but the findings were reworded —{" "}
              <span className="text-muted/70">the two verdicts are not comparable.</span>
            </>
          ) : changed ? (
            <>
              A different jury reached a{" "}
              <span style={{ color: toneOf(tally) }}>different verdict</span>.
            </>
          ) : (
            <>
              A different jury reached the{" "}
              <span style={{ color: toneOf(tally) }}>same verdict</span>.
            </>
          )}
        </p>
      </div>

      <div className="grid sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-white/8">
        {[
          {
            when: "Then",
            detail: `${heardOn.toLocaleDateString(undefined, {
              day: "numeric",
              month: "short",
              year: "numeric",
            })} · ${prior.verdicts.length} of ${prior.jurors.length} seats`,
            t: priorTally,
            file: prior.caseFile,
            href: `/archive/${prior.id}`,
          },
          {
            when: "Now",
            detail: `${verdicts.length} of ${jurors.length} seats`,
            t: tally,
            file: caseFile,
          },
        ].map((side) => (
          <div key={side.when} className="p-6 sm:p-7 text-center">
            <p className="mono text-[10px] tracking-[0.24em] uppercase text-muted/70">
              {side.when}
            </p>
            <p
              className="display text-2xl sm:text-3xl uppercase mt-2 leading-none"
              style={{ color: toneOf(side.t) }}
            >
              {label(side.t, side.file)}
            </p>
            <p className="mono text-[11px] tracking-[0.16em] uppercase text-muted mt-2 tabular-nums">
              {split(side.t)} · {side.detail}
            </p>
            {side.href && (
              <Link
                href={side.href}
                className="inline-block mt-3 mono text-[9px] tracking-[0.18em] uppercase text-brass/70
                           hover:text-brass-lit transition-colors underline underline-offset-4 decoration-dotted"
              >
                Read the old file
              </Link>
            )}
          </div>
        ))}
      </div>

      {sameQuestion && (
        <div className="px-6 sm:px-8 py-5 border-t border-white/8">
          <p className="mono text-[10px] tracking-[0.24em] uppercase text-muted mb-3">
            Who sat both times
          </p>

          {view.turned.length === 0 && view.steady === 0 ? (
            <p className="text-[14px] text-muted leading-relaxed">
              Nobody who returned a finding this time returned one before, so there is no juror
              to compare — only two juries.
            </p>
          ) : (
            <>
              <p className="text-[15px] text-bone/85 leading-relaxed">
                {view.turned.length === 0 ? (
                  <>
                    All {view.steady} found the same as they did before. On this case the room
                    is reproducible.
                  </>
                ) : (
                  <>
                    <span className="text-brass-lit">{view.turned.length}</span> of{" "}
                    {view.turned.length + view.steady} found differently the second time.
                  </>
                )}
              </p>

              {view.turned.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
                  {view.turned.map((j) => {
                    const was = view.before.get(j.id)!;
                    const now = verdicts.find((v) => v.jurorId === j.id)!;
                    return (
                      <li key={j.id}>
                        <button
                          onClick={() => onSelect(j.id)}
                          className="mono text-[11px] tracking-[0.1em] uppercase text-muted
                                     hover:text-brass-lit transition-colors"
                        >
                          {j.seat} {j.alias}
                          <span className="text-muted/50"> {caseFile.options[was.choice]} → </span>
                          <span
                            style={{ color: now.choice === 0 ? "var(--for)" : "var(--against)" }}
                          >
                            {caseFile.options[now.choice]}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}

          {(view.added.length > 0 || view.dropped.length > 0) && (
            <p className="mt-4 mono text-[10px] tracking-[0.14em] uppercase text-muted/60 leading-relaxed">
              {view.added.length > 0 && (
                <>
                  Newly seated · {view.added.map((j) => j.alias).join(", ")}
                  {view.dropped.length > 0 && " · "}
                </>
              )}
              {view.dropped.length > 0 && (
                <>Not sitting this time · {view.dropped.map((j) => j.alias).join(", ")}</>
              )}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
