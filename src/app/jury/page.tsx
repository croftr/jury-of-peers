"use client";

import Link from "next/link";
import JurorAvatar from "@/components/JurorAvatar";
import { JURORS, slugFor } from "@/lib/jurors";
import { MAX_INSTRUCTION, useJuryConfig } from "@/lib/juryConfig";
import { modelFor } from "@/lib/models";

export default function JuryPage() {
  const { config, toggleSeat, setInstruction, reset } = useJuryConfig();
  const seatedCount = config.seated.length;

  // Estimated cost of one case across the seated bench, on a ~1,200-token case
  // and ~350 tokens of reasoning each — the same shape as the sample.
  const estimate = JURORS.filter((j) => config.seated.includes(j.id)).reduce((sum, j) => {
    const m = modelFor(j.id);
    return m ? sum + (1200 * m.inPerM + 350 * m.outPerM) / 1_000_000 : sum;
  }, 0);

  // The smallest context window on the bench caps how large a case file can be.
  const tightest = JURORS.filter((j) => config.seated.includes(j.id))
    .map((j) => modelFor(j.id))
    .filter((m) => m !== undefined)
    .sort((a, b) => a.context - b.context)[0];

  return (
    <main className="relative z-10 mx-auto w-full max-w-5xl px-4 sm:px-8 py-10 sm:py-14">
      <header className="mb-10">
        <Link
          href="/"
          className="mono text-[10px] tracking-[0.24em] uppercase text-muted hover:text-brass-lit transition-colors"
        >
          ← Back to the court
        </Link>
        <p className="mono text-[10px] tracking-[0.34em] uppercase text-brass/70 mt-6">
          Empanelment
        </p>
        <h1 className="display text-[clamp(2.2rem,6vw,3.6rem)] leading-none mt-2">
          Choose your jury
        </h1>
        <div className="rule w-full mt-5" />
        <p className="mt-5 text-sm text-muted max-w-2xl leading-relaxed">
          Excuse any juror you don&apos;t want to hear the case, and give any of them a
          standing instruction to shape how they read the evidence. At least one juror must
          remain seated. Changes save as you make them and apply to the next case you
          charge.
        </p>
      </header>

      {/* Sticky summary — the two numbers that change as you edit the bench. */}
      <div className="sticky top-0 z-20 -mx-4 sm:-mx-8 px-4 sm:px-8 py-3 mb-8 bg-ink/90 backdrop-blur border-y border-white/8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-4">
            <span className="display text-2xl">
              {seatedCount}
              <span className="text-muted text-base"> of {JURORS.length} seated</span>
            </span>
            {seatedCount === 1 && (
              <span className="mono text-[9px] tracking-[0.16em] uppercase text-brass">
                Minimum bench
              </span>
            )}
          </div>
          <div className="flex items-center gap-4">
            <span className="mono text-[9px] tracking-[0.16em] uppercase text-muted tabular-nums">
              ≈ ${estimate.toFixed(4)} per case
            </span>
            <button
              onClick={reset}
              className="mono text-[9px] tracking-[0.16em] uppercase text-muted hover:text-brass-lit transition-colors underline underline-offset-4 decoration-dotted"
            >
              Restore all twelve
            </button>
          </div>
        </div>
      </div>

      {tightest && tightest.context < 100_000 && (
        <p className="panel rounded-lg px-4 py-3 mb-6 text-xs text-muted">
          <span className="text-brass">Note</span> — the smallest context window on this
          bench is {tightest.label} at {tightest.context.toLocaleString()} tokens (roughly{" "}
          {Math.round((tightest.context * 0.75) / 1000)}k words). A case file longer than
          that will be rejected by that juror alone; the rest will still return findings.
        </p>
      )}

      <div className="space-y-3">
        {JURORS.map((juror) => {
          const model = modelFor(juror.id);
          const seated = config.seated.includes(juror.id);
          const instruction = config.instructions[juror.id] ?? "";
          const lastSeated = seated && seatedCount === 1;

          return (
            <article
              key={juror.id}
              className="panel rounded-xl p-4 sm:p-5 transition-opacity"
              style={{ opacity: seated ? 1 : 0.45 }}
            >
              <div className="flex items-start gap-4">
                <Link
                  href={`/jury/${slugFor(juror)}`}
                  className="size-14 sm:size-16 shrink-0 rounded-full overflow-hidden transition-transform hover:scale-105"
                  style={{
                    boxShadow: seated
                      ? "inset 0 0 0 1.5px rgba(201,162,39,0.5)"
                      : "inset 0 0 0 1px rgba(255,255,255,0.12)",
                  }}
                  aria-label={`${juror.alias} full profile`}
                >
                  <JurorAvatar spec={juror.avatar} mood={seated ? "idle" : "thinking"} className="size-full" />
                </Link>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <div className="min-w-0">
                      <p className="mono text-[10px] tracking-[0.2em] uppercase text-muted">
                        Seat {juror.seat} · {juror.archetype}
                      </p>
                      <h2 className="display text-2xl mt-0.5">
                        <Link href={`/jury/${slugFor(juror)}`} className="hover:text-brass-lit transition-colors">
                          {juror.alias}
                        </Link>
                      </h2>
                    </div>

                    <button
                      onClick={() => toggleSeat(juror.id)}
                      disabled={lastSeated}
                      title={lastSeated ? "A jury needs at least one juror" : undefined}
                      className={`mono text-[9px] tracking-[0.18em] uppercase px-3 py-2 rounded-md border transition-colors shrink-0 ${
                        seated
                          ? "border-brass/50 text-brass-lit bg-brass/10 hover:bg-brass/20"
                          : "border-white/12 text-muted hover:text-bone hover:border-white/30"
                      } disabled:opacity-40 disabled:cursor-not-allowed`}
                    >
                      {seated ? "Seated" : "Excused"}
                    </button>
                  </div>

                  <p className="text-sm text-muted mt-2 leading-relaxed">{juror.disposition}</p>

                  {model && (
                    <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 mono text-[10px] tracking-[0.1em] uppercase text-muted/70">
                      <div>
                        <dt className="sr-only">Model</dt>
                        <dd className="text-bone/80">{model.label}</dd>
                      </div>
                      <div>
                        <dt className="sr-only">Lab</dt>
                        <dd>{model.lab}</dd>
                      </div>
                      <div>
                        <dt className="sr-only">Context window</dt>
                        <dd className="tabular-nums">
                          {(model.context / 1000).toFixed(0)}k ctx
                        </dd>
                      </div>
                      <div>
                        <dt className="sr-only">Price</dt>
                        <dd className="tabular-nums">
                          ${model.inPerM}/${model.outPerM} per M
                        </dd>
                      </div>
                    </dl>
                  )}

                  <label className="block mt-4">
                    <span className="mono text-[10px] tracking-[0.2em] uppercase text-muted">
                      Standing instruction
                      {instruction && <span className="text-brass"> · set</span>}
                    </span>
                    <textarea
                      value={instruction}
                      onChange={(e) => setInstruction(juror.id, e.target.value)}
                      maxLength={MAX_INSTRUCTION}
                      rows={2}
                      placeholder="Optional. e.g. “Weigh documentary evidence above witness recollection.” Shapes how this juror reads the case; it cannot make them invent facts or return a third finding."
                      className="mt-2 w-full bg-black/30 border border-white/8 rounded-lg px-3 py-2.5 text-sm leading-relaxed
                                 outline-none focus:border-brass/50 focus:bg-black/45 transition-colors resize-y
                                 placeholder:text-white/20"
                    />
                  </label>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <div className="mt-10 flex justify-center">
        <Link
          href="/"
          className="mono text-[11px] tracking-[0.26em] uppercase px-7 py-3.5 rounded-lg border border-brass/45
                     text-brass-lit hover:bg-brass/10 hover:border-brass transition-colors"
        >
          Return to the court
        </Link>
      </div>
    </main>
  );
}
