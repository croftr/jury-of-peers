"use client";

import type { CaseFile, Juror, JurorVerdict, Tally } from "@/lib/types";

export default function VerdictPanel({
  jurors,
  caseFile,
  tally,
  verdicts,
  failures,
  onReset,
  resetLabel = "Empanel a new jury",
  onSelect,
}: {
  jurors: Juror[];
  caseFile: CaseFile;
  tally: Tally;
  verdicts: JurorVerdict[];
  failures: Map<number, string>;
  onReset: () => void;
  /** What the button under the seal offers to do next. */
  resetLabel?: string;
  onSelect: (jurorId: number) => void;
}) {
  const tone = tally.majority === 0 ? "var(--for)" : "var(--against)";
  const headline = tally.hung ? "Hung jury" : caseFile.options[tally.majority];
  const split = `${tally.counts[tally.majority]}–${tally.counts[tally.majority === 0 ? 1 : 0]}`;

  // The phrase the room kept circling back to.
  const pivots = new Map<string, number>();
  for (const v of verdicts) pivots.set(v.pivot, (pivots.get(v.pivot) ?? 0) + 1);
  const [topPivot, pivotCount] = [...pivots.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];

  const dissenters = verdicts.filter((v) => v.choice !== tally.majority);
  const cost = verdicts.reduce((sum, v) => sum + (v.usage?.costUsd ?? 0), 0);
  const simulated = verdicts.some((v) => v.source === "simulated");

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
          <p className="mono text-[10px] tracking-[0.34em] uppercase text-muted">
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

          <p className="mono text-xs tracking-[0.22em] uppercase text-bone/70">
            {tally.hung
              ? `Deadlocked ${split} — the room will not move`
              : tally.unanimous
                ? `Unanimous · ${verdicts.length} of ${verdicts.length}`
                : tally.counts[tally.majority] >= Math.ceil((jurors.length * 5) / 6)
                  ? `By ${split} — a decisive majority`
                  : `By ${split} — a divided room`}
          </p>

          {failures.size > 0 && (
            <p className="mono text-[9px] tracking-[0.18em] uppercase text-for/80 mt-3">
              {failures.size} of {jurors.length} seats empty · verdict returned by the{" "}
              {verdicts.length} jurors who answered
            </p>
          )}

          {/* the twelve, at a glance */}
          <div className="mt-8 flex flex-wrap justify-center gap-1.5">
            {jurors.map((j, i) => {
              const v = verdicts.find((x) => x.jurorId === j.id);
              const c = v ? (v.choice === 0 ? "var(--for)" : "var(--against)") : "rgba(255,255,255,.1)";
              return (
                <button
                  key={j.id}
                  onClick={() => onSelect(j.id)}
                  title={`${j.seat} · ${j.alias}`}
                  className="h-8 w-6 rounded-sm a-rise transition-transform hover:scale-125"
                  style={{
                    background: c,
                    opacity: v ? 0.35 + v.confidence * 0.65 : 0.3,
                    animationDelay: `${i * 45}ms`,
                  }}
                />
              );
            })}
          </div>

          {/* conviction strength */}
          <div className="mt-8 max-w-md mx-auto">
            <div className="flex justify-between mono text-[9px] tracking-[0.2em] uppercase text-muted mb-2">
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
            <p className="mono text-[10px] tracking-[0.24em] uppercase text-muted mb-3">
              What the room kept returning to
            </p>
            <p className="display text-2xl">{topPivot}</p>
            <p className="text-xs text-muted mt-2">
              Raised by {pivotCount} of {verdicts.length} jurors.
            </p>
          </div>

          <div className="p-6 sm:p-8">
            <p className="mono text-[10px] tracking-[0.24em] uppercase text-muted mb-3">
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
                        className="text-sm text-bone/85 hover:text-brass-lit transition-colors text-left"
                      >
                        <span className="mono text-[10px] text-muted mr-2">{j.seat}</span>
                        {j.alias} — {caseFile.options[d.choice]}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-muted">
                {verdicts.length === 1
                  ? "The only juror empanelled decided it alone."
                  : `All ${verdicts.length} arrived at the same finding. That is rarer than it sounds.`}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="mt-6 flex flex-col items-center gap-3">
        <p className="mono text-[9px] tracking-[0.2em] uppercase text-muted/60 tabular-nums">
          {simulated
            ? "Simulated deliberation · no models called"
            : `Deliberation cost $${cost.toFixed(4)}`}
        </p>
        <button
          onClick={onReset}
          className="mono text-[10px] tracking-[0.26em] uppercase px-6 py-3 rounded-lg border border-white/12
                     text-muted hover:text-brass-lit hover:border-brass/50 transition-colors"
        >
          {resetLabel}
        </button>
      </div>
    </section>
  );
}
