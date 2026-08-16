"use client";

import { tally as computeTally } from "@/lib/deliberate";
import type { CaseFile, Juror, JurorVerdict, Tally } from "@/lib/types";

const COUNT = ["no", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"];

export default function VerdictPanel({
  jurors,
  caseFile,
  tally,
  verdicts,
  failures,
  round = 1,
  firstRound,
  heldOver,
  onReconsider,
  onReset,
  resetLabel = "Empanel a new jury",
  onSelect,
}: {
  jurors: Juror[];
  caseFile: CaseFile;
  tally: Tally;
  verdicts: JurorVerdict[];
  failures: Map<number, string>;
  /** 1 is the silent round; 2 is after every juror heard the room. */
  round?: 1 | 2;
  /** Where each juror stood before the room went back out. */
  firstRound?: Map<number, JurorVerdict>;
  /** Jurors who could not be reached the second time and kept their first finding. */
  heldOver?: Map<number, string>;
  /** Offered only after the first round, and only when there is a room to hear. */
  onReconsider?: () => void;
  onReset: () => void;
  /** What the button under the seal offers to do next. */
  resetLabel?: string;
  onSelect: (jurorId: number) => void;
}) {
  const tone = tally.majority === 0 ? "var(--for)" : "var(--against)";
  const headline = tally.hung ? "Hung jury" : caseFile.options[tally.majority];
  const split = `${tally.counts[tally.majority]}–${tally.counts[tally.majority === 0 ? 1 : 0]}`;

  /* ── What the second round changed ──────────────────────────────────────
   * Everything here is derived by comparing the two rounds rather than stored,
   * so it cannot drift from the findings actually on screen. */
  const heard = round === 2 && firstRound && firstRound.size > 0;
  const before = heard ? computeTally([...firstRound.values()]) : null;
  const movers = heard
    ? verdicts.filter((v) => {
        const was = firstRound.get(v.jurorId);
        return was && was.choice !== v.choice;
      })
    : [];
  const moved = new Set(movers.map((v) => v.jurorId));
  // A room can be moved without changing its mind: the count holds, the
  // conviction behind it does not.
  const convictionShift = before ? tally.strength - before.strength : 0;
  const beforeSplit = before
    ? `${before.counts[before.majority]}–${before.counts[before.majority === 0 ? 1 : 0]}`
    : "";
  const flipped = Boolean(before) && !before!.hung && !tally.hung && before!.majority !== tally.majority;

  // The phrase the room kept circling back to.
  const pivots = new Map<string, number>();
  for (const v of verdicts) pivots.set(v.pivot, (pivots.get(v.pivot) ?? 0) + 1);
  const [topPivot, pivotCount] = [...pivots.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];

  const dissenters = verdicts.filter((v) => v.choice !== tally.majority);
  const simulated = verdicts.some((v) => v.source === "simulated");

  // Both rounds, counted once each. A juror held over from the first round is
  // the same verdict object in both maps, so their call is not billed twice.
  const spend = (list: JurorVerdict[]) => list.reduce((sum, v) => sum + (v.usage?.costUsd ?? 0), 0);
  const cost = heard
    ? spend([...firstRound.values()]) + spend(verdicts.filter((v) => !heldOver?.has(v.jurorId)))
    : spend(verdicts);

  return (
    <section className="relative">
      {/* gavel strike */}
      <span
        className="pointer-events-none absolute left-1/2 top-24 -translate-x-1/2 size-64 rounded-full"
        style={{
          background: `radial-gradient(closest-side, ${tone}, transparent 70%)`,
          animation: "shockwave 1.2s ease-out 1 both",
        }}
      />

      <div
        className="panel rounded-2xl overflow-hidden relative a-shake"
        style={{ boxShadow: `0 40px 120px -60px ${tone}` }}
      >
        <div className="h-px" style={{ background: `linear-gradient(90deg,transparent,${tone},transparent)` }} />

        <div className="px-6 sm:px-10 py-10 text-center">
          <p className="mono text-[12px] tracking-[0.34em] uppercase text-muted">
            In the matter of
          </p>
          <p className="display text-lg mt-1 text-bone/80">
            {caseFile.title || "an untitled matter"}
          </p>

          <div className="my-8 flex justify-center">
            <div
              className="a-seal px-8 py-5 rounded-xl border-2"
              style={{ borderColor: tone, color: tone, boxShadow: `0 0 60px -20px ${tone}` }}
            >
              <h2 className="display text-[clamp(2.2rem,7vw,4.5rem)] leading-none uppercase tracking-wide">
                {headline}
              </h2>
            </div>
          </div>

          <p className="mono text-[13px] tracking-[0.22em] uppercase text-bone/70">
            {tally.hung
              ? `Deadlocked ${split} — the room will not move`
              : tally.unanimous
                ? `Unanimous · ${verdicts.length} of ${verdicts.length}`
                : tally.counts[tally.majority] >= Math.ceil((jurors.length * 5) / 6)
                  ? `By ${split} — a decisive majority`
                  : `By ${split} — a divided room`}
          </p>

          {failures.size > 0 && (
            <p className="mono text-[11px] tracking-[0.18em] uppercase text-for/80 mt-3">
              {failures.size} of {jurors.length} seats empty · verdict returned by the{" "}
              {verdicts.length} jurors who answered
            </p>
          )}

          {/* What came of sending them back out. The count before and after is
              the whole point of the second round, so it is stated plainly. */}
          {heard && (
            <div className="mt-5 mx-auto max-w-lg">
              <div className="rule mb-4" />
              <p className="mono text-[11px] tracking-[0.24em] uppercase text-brass/70">
                Heard a second time
              </p>
              <p className="display text-xl sm:text-2xl mt-2 leading-snug">
                {movers.length === 0 ? (
                  <>
                    Nobody moved. <span className="text-muted/70">{beforeSplit} stands.</span>
                  </>
                ) : flipped ? (
                  <>
                    {COUNT[movers.length] ?? movers.length} moved, and the room turned over —{" "}
                    <span className="text-muted/70">{beforeSplit}</span> became{" "}
                    <span style={{ color: tone }}>{split}</span>.
                  </>
                ) : (
                  <>
                    {COUNT[movers.length] ?? movers.length}{" "}
                    {movers.length === 1 ? "juror" : "jurors"} moved —{" "}
                    <span className="text-muted/70">{beforeSplit}</span> became{" "}
                    <span style={{ color: tone }}>{split}</span>.
                  </>
                )}
              </p>
              {movers.length > 0 && (
                <ul className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1">
                  {movers.map((v) => {
                    const j = jurors.find((x) => x.id === v.jurorId);
                    if (!j) return null;
                    return (
                      <li key={v.jurorId}>
                        <button
                          onClick={() => onSelect(v.jurorId)}
                          className="mono text-[11px] tracking-[0.1em] uppercase text-muted
                                     hover:text-brass-lit transition-colors"
                        >
                          {j.seat} {j.alias}
                          <span className="text-muted/50">
                            {" "}
                            {caseFile.options[firstRound!.get(v.jurorId)!.choice]} →{" "}
                          </span>
                          <span style={{ color: v.choice === 0 ? "var(--for)" : "var(--against)" }}>
                            {caseFile.options[v.choice]}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {movers.length === 0 && Math.abs(convictionShift) >= 0.02 && (
                <p className="mono text-[11px] tracking-[0.16em] uppercase text-muted/70 mt-2">
                  The room held, but its conviction {convictionShift > 0 ? "rose" : "fell"}{" "}
                  {Math.abs(Math.round(convictionShift * 100))} points
                </p>
              )}
              {heldOver && heldOver.size > 0 && (
                <p className="mono text-[11px] tracking-[0.16em] uppercase text-muted/60 mt-2">
                  {heldOver.size} {heldOver.size === 1 ? "juror" : "jurors"} could not be reached
                  the second time · their first finding stands
                </p>
              )}
            </div>
          )}

          {/* the twelve, at a glance */}
          <div className="mt-8 flex flex-wrap justify-center gap-1.5">
            {jurors.map((j, i) => {
              const v = verdicts.find((x) => x.jurorId === j.id);
              const c = v ? (v.choice === 0 ? "var(--for)" : "var(--against)") : "rgba(255,255,255,.1)";
              const turned = moved.has(j.id);
              const was = firstRound?.get(j.id);
              return (
                <button
                  key={j.id}
                  onClick={() => onSelect(j.id)}
                  title={
                    turned && was
                      ? `${j.seat} · ${j.alias} — moved from ${caseFile.options[was.choice]}`
                      : `${j.seat} · ${j.alias}`
                  }
                  className="relative h-8 w-6 rounded-sm a-rise transition-transform hover:scale-125"
                  style={{
                    background: c,
                    opacity: v ? 0.35 + v.confidence * 0.65 : 0.3,
                    animationDelay: `${i * 45}ms`,
                  }}
                >
                  {/* A juror who changed their mind is worth being able to find
                      at a glance, so they carry a mark the others do not. */}
                  {turned && (
                    <span
                      aria-hidden
                      className="absolute -top-1 left-1/2 -translate-x-1/2 size-1.5 rounded-full bg-brass-lit"
                      style={{ boxShadow: "0 0 6px var(--brass)" }}
                    />
                  )}
                </button>
              );
            })}
          </div>

          {/* conviction strength */}
          <div className="mt-8 max-w-md mx-auto">
            <div className="flex justify-between mono text-[11px] tracking-[0.2em] uppercase text-muted mb-2">
              <span>Conviction of the majority</span>
              <span className="tabular-nums">{Math.round(tally.strength * 100)}%</span>
            </div>
            <div className="h-1 rounded-full bg-white/8 overflow-hidden">
              <div
                className="h-full origin-left"
                style={{
                  width: `${tally.strength * 100}%`,
                  background: tone,
                  animation: "bar-grow 1.4s cubic-bezier(0.16,1,0.3,1) both",
                }}
              />
            </div>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 border-t border-white/8">
          <div className="p-6 sm:p-8 border-b sm:border-b-0 sm:border-r border-white/8">
            <p className="mono text-[12px] tracking-[0.24em] uppercase text-muted mb-3">
              What the room kept returning to
            </p>
            <p className="display text-2xl">{topPivot}</p>
            <p className="text-[13px] text-muted mt-2">
              Raised by {pivotCount} of {verdicts.length} jurors.
            </p>
          </div>

          <div className="p-6 sm:p-8">
            <p className="mono text-[12px] tracking-[0.24em] uppercase text-muted mb-3">
              {dissenters.length ? "The dissent" : "No dissent"}
            </p>
            {dissenters.length ? (
              <ul className="space-y-1.5">
                {dissenters.map((d) => {
                  const j = jurors.find((x) => x.id === d.jurorId)!;
                  return (
                    <li key={d.jurorId}>
                      <button
                        onClick={() => onSelect(d.jurorId)}
                        className="text-[15px] text-bone/85 hover:text-brass-lit transition-colors text-left"
                      >
                        <span className="mono text-[12px] text-muted mr-2">{j.seat}</span>
                        {j.alias} — {caseFile.options[d.choice]}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-[15px] text-muted">
                {verdicts.length === 1
                  ? "The only juror empanelled decided it alone."
                  : `All ${verdicts.length} arrived at the same finding. That is rarer than it sounds.`}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="mt-6 flex flex-col items-center gap-3">
        {/* The room can only be sent out again once, and only if there was a
            room to hear — a single juror has nobody to reconsider in front of. */}
        {round === 1 && onReconsider && verdicts.length >= 2 && (
          <>
            <button
              onClick={onReconsider}
              className="group relative px-7 py-3.5 rounded-lg overflow-hidden border border-brass/45
                         hover:border-brass hover:bg-brass/10 transition-colors"
            >
              <span className="mono text-[13px] tracking-[0.28em] uppercase text-brass-lit">
                Send them back out
              </span>
              <span className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity">
                <span className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-brass/25 to-transparent a-sweep" />
              </span>
            </button>
            <p className="max-w-sm text-center text-[13px] text-muted/70 leading-relaxed">
              Each juror hears what the other {verdicts.length - 1} found and why, then is asked
              once more.{" "}
              {simulated
                ? "Simulated, so it costs nothing."
                : `Another ${verdicts.length} calls, at roughly what the first round cost.`}
            </p>
          </>
        )}

        <p className="mono text-[11px] tracking-[0.2em] uppercase text-muted/60 tabular-nums">
          {simulated
            ? "Simulated deliberation · no models called"
            : `${heard ? "Both rounds cost" : "Deliberation cost"} $${cost.toFixed(4)}`}
        </p>
        <button
          onClick={onReset}
          className="mono text-[12px] tracking-[0.26em] uppercase px-6 py-3 rounded-lg border border-white/12
                     text-muted hover:text-brass-lit hover:border-brass/50 transition-colors"
        >
          {resetLabel}
        </button>
      </div>
    </section>
  );
}
