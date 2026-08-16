"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import JurorAvatar from "@/components/JurorAvatar";
import { nominalCost } from "@/lib/estimate";
import { JURORS, slugFor } from "@/lib/jurors";
import { MAX_INSTRUCTION, useJuryConfig } from "@/lib/juryConfig";
import { modelFor } from "@/lib/models";

type SortKey = "seat" | "cost" | "context";
type Direction = "asc" | "desc";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "seat", label: "Seat order" },
  { key: "cost", label: "Cost per case" },
  { key: "context", label: "Context window" },
];

/** The direction each sort should open with — cheapest first, biggest window first. */
const OPENS: Record<SortKey, Direction> = {
  seat: "asc",
  cost: "asc",
  context: "desc",
};

export default function JuryPage() {
  const { config, toggleSeat, removeAll, restoreAll, setInstruction } = useJuryConfig();
  const seatedCount = config.seated.length;
  const [sort, setSort] = useState<SortKey>("seat");
  const [direction, setDirection] = useState<Direction>("asc");
  /** Which juror's standing instruction is open for editing — one at a time. */
  const [editing, setEditing] = useState<number | null>(null);

  const ordered = useMemo(() => {
    const sign = direction === "asc" ? 1 : -1;
    const value = (id: number) => {
      const m = modelFor(id);
      switch (sort) {
        case "cost":
          return m ? nominalCost(m) : 0;
        case "context":
          return m?.context ?? 0;
        default:
          return id;
      }
    };
    // Seat order breaks every tie, so equal values stay in a stable, familiar order.
    return [...JURORS].sort((a, b) => sign * (value(a.id) - value(b.id)) || a.id - b.id);
  }, [sort, direction]);

  const chooseSort = (key: SortKey) => {
    if (key === sort) setDirection((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSort(key);
      setDirection(OPENS[key]);
    }
  };

  // Estimated cost of one round across the seated bench, on a case the size of
  // the sample. The court itself estimates from the case actually in the file.
  const estimate = JURORS.filter((j) => config.seated.includes(j.id)).reduce((sum, j) => {
    const m = modelFor(j.id);
    return m ? sum + nominalCost(m) : sum;
  }, 0);

  // The smallest context window on the bench caps how large a case file can be.
  const tightest = JURORS.filter((j) => config.seated.includes(j.id))
    .map((j) => modelFor(j.id))
    .filter((m) => m !== undefined)
    .sort((a, b) => a.context - b.context)[0];

  return (
    <main className="relative z-10 mx-auto w-full max-w-5xl px-4 sm:px-8 py-10 sm:py-14">
      <header className="mb-6">
        <Link
          href="/"
          className="mono text-[10px] tracking-[0.24em] uppercase text-muted hover:text-brass-lit transition-colors"
        >
          ← Back to the court
        </Link>
        <p className="mono text-[10px] tracking-[0.34em] uppercase text-brass/70 mt-5">
          Empanelment
        </p>
        <h1 className="display text-[clamp(2rem,6vw,3.6rem)] leading-none mt-2">
          Choose your jury
        </h1>
        <p className="mt-3 text-sm text-muted leading-relaxed">
          Excuse anyone you don&apos;t want on the case. Changes save as you make them.
        </p>
        <div className="rule w-full mt-4" />
      </header>

      {/* Sticky summary — the two numbers that change as you edit the bench. */}
      <div className="sticky top-0 z-20 -mx-4 sm:-mx-8 px-4 sm:px-8 py-3 mb-8 bg-ink/90 backdrop-blur border-y border-white/8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-4">
            <span className="display text-2xl">
              {seatedCount}
              <span className="text-muted text-base"> of {JURORS.length} seated</span>
            </span>
            {seatedCount === 0 && (
              <span className="mono text-[9px] tracking-[0.16em] uppercase text-for">
                Empty bench
              </span>
            )}
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
              onClick={removeAll}
              disabled={seatedCount === 0}
              className="mono text-[9px] tracking-[0.16em] uppercase text-muted hover:text-brass-lit transition-colors underline underline-offset-4 decoration-dotted disabled:opacity-40 disabled:hover:text-muted disabled:cursor-not-allowed"
            >
              Excuse all
            </button>
            <button
              onClick={restoreAll}
              disabled={seatedCount === JURORS.length}
              className="mono text-[9px] tracking-[0.16em] uppercase text-muted hover:text-brass-lit transition-colors underline underline-offset-4 decoration-dotted disabled:opacity-40 disabled:hover:text-muted disabled:cursor-not-allowed"
            >
              Seat all
            </button>
          </div>
        </div>
      </div>

      {tightest && tightest.context < 100_000 && (
        <p className="panel rounded-lg px-3.5 py-2.5 mb-4 text-xs text-muted leading-relaxed">
          <span className="text-brass">Note</span> — {tightest.label} has the smallest window
          on this bench, about {Math.round((tightest.context * 0.75) / 1000)}k words. A longer
          case loses that juror only.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="mono text-[10px] tracking-[0.2em] uppercase text-muted mr-1">
          Sort by
        </span>
        {SORTS.map(({ key, label }) => {
          const active = sort === key;
          return (
            <button
              key={key}
              onClick={() => chooseSort(key)}
              aria-pressed={active}
              title={active ? "Click again to reverse" : undefined}
              className={`mono text-[9px] tracking-[0.16em] uppercase px-3 py-2 rounded-md border transition-colors ${active
                  ? "border-brass/50 text-brass-lit bg-brass/10"
                  : "border-white/10 text-muted hover:text-bone hover:border-white/25"
                }`}
            >
              {label}
              {active && (
                <span aria-hidden className="ml-1.5">
                  {direction === "asc" ? "↑" : "↓"}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="grid gap-3 md:grid-cols-2 items-start">
        {ordered.map((juror) => {
          const model = modelFor(juror.id);
          const seated = config.seated.includes(juror.id);
          const instruction = config.instructions[juror.id] ?? "";
          const open = editing === juror.id;

          return (
            <article
              key={juror.id}
              className="panel rounded-xl p-3.5 sm:p-4 transition-opacity"
              style={{ opacity: seated ? 1 : 0.45 }}
            >
              {/* The avatar sits on the name only — everything below runs the
                  full width of the card rather than beside an empty column. */}
              <div className="flex items-center gap-3">
                <Link
                  href={`/jury/${slugFor(juror)}`}
                  className="size-12 sm:size-14 shrink-0 rounded-full overflow-hidden transition-transform hover:scale-105"
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
                  <p className="mono text-[9px] tracking-[0.18em] uppercase text-muted truncate">
                    Seat {juror.seat} · {juror.archetype}
                  </p>
                  <h2 className="display text-xl sm:text-2xl leading-tight mt-0.5 truncate">
                    <Link href={`/jury/${slugFor(juror)}`} className="hover:text-brass-lit transition-colors">
                      {juror.alias}
                    </Link>
                  </h2>
                </div>

                <button
                  onClick={() => toggleSeat(juror.id)}
                  aria-pressed={seated}
                  className={`mono text-[9px] tracking-[0.16em] uppercase px-2.5 py-2 rounded-md border transition-colors shrink-0 ${
                    seated
                      ? "border-brass/50 text-brass-lit bg-brass/10 hover:bg-brass/20"
                      : "border-white/12 text-muted hover:text-bone hover:border-white/30"
                  }`}
                >
                  {seated ? "Seated" : "Excused"}
                </button>
              </div>

              <p className="text-[13px] text-muted mt-2.5 leading-snug">{juror.disposition}</p>

              {/* One line of figures instead of a five-column table. */}
              {model && (
                <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 mono text-[10px] tracking-[0.1em] uppercase tabular-nums">
                  <span className="text-bone">{model.label}</span>
                  <span className="text-muted/60">{model.lab}</span>
                  <Dot />
                  <span className={model.context < 100_000 ? "text-brass" : "text-muted/60"}>
                    {(model.context / 1000).toFixed(0)}k ctx
                  </span>
                  <Dot />
                  <span
                    className="text-muted/60"
                    title={`$${model.inPerM} in · $${model.outPerM} out, per million tokens`}
                  >
                    ≈ ${nominalCost(model).toFixed(5)} / case
                  </span>
                </div>
              )}

              {/* Standing instructions are the exception, not the rule, so they
                  stay folded away until asked for. */}
              <div className="mt-2.5 pt-2.5 border-t border-white/6">
                <button
                  onClick={() => setEditing(open ? null : juror.id)}
                  aria-expanded={open}
                  className="w-full flex items-center gap-2 text-left mono text-[9px] tracking-[0.16em] uppercase
                             text-muted hover:text-brass-lit transition-colors"
                >
                  <span aria-hidden className={`transition-transform ${open ? "rotate-90" : ""}`}>
                    ›
                  </span>
                  <span className="shrink-0">
                    Instruction
                    {instruction && <span className="text-brass"> · set</span>}
                  </span>
                  {instruction && !open && (
                    <span className="min-w-0 truncate normal-case tracking-normal text-[11px] text-muted/60">
                      {instruction}
                    </span>
                  )}
                </button>

                {open && (
                  <textarea
                    autoFocus
                    value={instruction}
                    onChange={(e) => setInstruction(juror.id, e.target.value)}
                    maxLength={MAX_INSTRUCTION}
                    rows={2}
                    placeholder="e.g. “Weigh documents above recollection.” Shapes how they read the case; it cannot invent facts."
                    className="mt-2 w-full bg-black/30 border border-white/8 rounded-lg px-3 py-2.5 text-[13px] leading-relaxed
                               outline-none focus:border-brass/50 focus:bg-black/45 transition-colors resize-y
                               placeholder:text-white/20"
                  />
                )}
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

/** The separator between figures in a juror's stat line. */
function Dot() {
  return (
    <span aria-hidden className="text-muted/25">
      ·
    </span>
  );
}
