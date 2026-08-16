"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import JurorAvatar from "@/components/JurorAvatar";
import { JURORS, getJuror, slugFor } from "@/lib/jurors";
import { modelFor } from "@/lib/models";
import type { ArchiveRecord, JurorRecord } from "@/lib/record";

type SortKey = "seat" | "dissent" | "moved" | "confidence";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "seat", label: "Seat order" },
  { key: "dissent", label: "Most dissenting" },
  { key: "moved", label: "Most movable" },
  { key: "confidence", label: "Most confident" },
];

const pct = (n: number) => `${Math.round(n * 100)}%`;

/** A bar that reads at a glance, since every row is a proportion of something. */
function Bar({ value, tone }: { value: number; tone: string }) {
  return (
    <span className="block h-1 rounded-full bg-white/8 overflow-hidden">
      <span
        className="block h-full"
        style={{ width: `${Math.min(100, value * 100)}%`, background: tone }}
      />
    </span>
  );
}

export default function RecordPage() {
  const [record, setRecord] = useState<ArchiveRecord | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("seat");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/record")
      .then(async (res) => {
        const payload = await res.json();
        if (!res.ok) throw new Error(payload?.error ?? "The record could not be read.");
        return payload as { enabled: boolean; record?: ArchiveRecord };
      })
      .then((payload) => {
        if (cancelled) return;
        setEnabled(payload.enabled);
        setRecord(payload.record ?? null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "The record could not be read.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const ordered = useMemo(() => {
    if (!record) return [];
    const rate = (r: JurorRecord) => (r.sat ? r.dissents / r.sat : 0);
    const movable = (r: JurorRecord) => (r.couldMove ? r.moved / r.couldMove : 0);
    const value = (r: JurorRecord) => {
      switch (sort) {
        case "dissent":
          return -rate(r);
        case "moved":
          return -movable(r);
        case "confidence":
          return -r.confidence;
        default:
          return r.jurorId;
      }
    };
    return [...record.jurors].sort((a, b) => value(a) - value(b) || a.jurorId - b.jurorId);
  }, [record, sort]);

  /* The pair that agrees most and the pair that agrees least, among jurors who
     have actually sat together enough times for it to mean anything. */
  const poles = useMemo(() => {
    if (!record) return null;
    const solid = record.agreements.filter((p) => p.together >= 3);
    if (solid.length < 2) return null;
    const byRate = [...solid].sort((a, b) => b.agreed / b.together - a.agreed / a.together);
    return { closest: byRate[0], furthest: byRate[byRate.length - 1] };
  }, [record]);

  const name = (id: number) => getJuror(id)?.alias ?? `Seat ${id}`;

  return (
    <main className="relative z-10 mx-auto w-full max-w-5xl px-4 sm:px-8 py-10 sm:py-14">
      <nav className="flex items-center justify-between mb-10">
        <Link
          href="/archive"
          className="mono text-[10px] tracking-[0.24em] uppercase text-muted hover:text-brass-lit transition-colors"
        >
          ← Past cases
        </Link>
        <Link
          href="/"
          className="mono text-[10px] tracking-[0.24em] uppercase text-muted hover:text-brass-lit transition-colors"
        >
          The court →
        </Link>
      </nav>

      <header className="text-center mb-10">
        <p className="mono text-[10px] tracking-[0.42em] uppercase text-brass/70">
          Across every case
        </p>
        <h1 className="display text-[clamp(2.2rem,7vw,4rem)] leading-[0.95] mt-3">
          The jurors&apos; <span className="text-brass-lit">record</span>
        </h1>
        <div className="rule w-56 mx-auto mt-5" />
        <p className="mt-5 text-sm text-muted max-w-xl mx-auto leading-relaxed">
          One case tells you what twelve models made of one matter. The whole archive tells you
          which of them dissents, which of them can be argued round, and whose confidence is
          worth anything.
        </p>
      </header>

      {error && <p className="mb-6 text-center text-sm text-for">{error}</p>}

      {!error && !enabled && (
        <p className="text-center text-sm text-muted leading-relaxed max-w-md mx-auto">
          No archive is configured, so there is no record to read. Set{" "}
          <span className="mono text-brass/80">CASES_BUCKET</span> and the jurors will start
          building one.
        </p>
      )}

      {!error && enabled && !record && (
        <p className="text-center mono text-[10px] tracking-[0.26em] uppercase text-muted/60">
          Reading every case…
        </p>
      )}

      {record && record.counted === 0 && (
        <p className="text-center text-sm text-muted max-w-md mx-auto leading-relaxed">
          Nothing to count yet.{" "}
          {record.skipped > 0
            ? `The ${record.skipped} case${record.skipped === 1 ? "" : "s"} on file ${
                record.skipped === 1 ? "was" : "were"
              } decided before the court kept a record of who voted how. New cases will count.`
            : "Put a case to the jury and it will start here."}
        </p>
      )}

      {record && record.counted > 0 && (
        <>
          {/* What kind of archive this is, before any per-juror detail. */}
          <div className="panel rounded-2xl p-5 sm:p-6 mb-8">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
              {[
                { n: record.counted, label: "cases counted" },
                { n: record.contested, label: "split rooms" },
                { n: record.unanimous, label: "unanimous" },
                { n: record.hung, label: "hung" },
              ].map((stat) => (
                <div key={stat.label}>
                  <p className="display text-3xl tabular-nums">{stat.n}</p>
                  <p className="mono text-[9px] tracking-[0.18em] uppercase text-muted/70 mt-1">
                    {stat.label}
                  </p>
                </div>
              ))}
            </div>
            {record.skipped > 0 && (
              <p className="mono text-[9px] tracking-[0.14em] uppercase text-muted/50 mt-4 text-center">
                {record.skipped} older case{record.skipped === 1 ? "" : "s"} not counted · filed
                before the court kept who voted how
              </p>
            )}
          </div>

          {poles && (
            <div className="grid sm:grid-cols-2 gap-3 mb-8">
              <div className="panel rounded-xl p-5">
                <p className="mono text-[9px] tracking-[0.2em] uppercase text-muted/70">
                  Closest two
                </p>
                <p className="display text-xl mt-1.5">
                  {name(poles.closest.a)} and {name(poles.closest.b)}
                </p>
                <p className="text-[13px] text-muted mt-1 tabular-nums">
                  Agreed on {poles.closest.agreed} of {poles.closest.together} cases they both
                  sat.
                </p>
              </div>
              <div className="panel rounded-xl p-5">
                <p className="mono text-[9px] tracking-[0.2em] uppercase text-muted/70">
                  Furthest apart
                </p>
                <p className="display text-xl mt-1.5">
                  {name(poles.furthest.a)} and {name(poles.furthest.b)}
                </p>
                <p className="text-[13px] text-muted mt-1 tabular-nums">
                  Agreed on {poles.furthest.agreed} of {poles.furthest.together} cases they both
                  sat.
                </p>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 mb-3">
            {SORTS.map((s) => (
              <button
                key={s.key}
                onClick={() => setSort(s.key)}
                className={`mono text-[9px] tracking-[0.16em] uppercase px-3 py-1.5 rounded-md border transition-colors ${
                  sort === s.key
                    ? "border-brass/60 bg-brass/10 text-brass-lit"
                    : "border-white/10 text-muted hover:border-white/25"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          <ul className="panel rounded-2xl overflow-hidden divide-y divide-white/8">
            {ordered.map((r, i) => {
              const juror = getJuror(r.jurorId);
              if (!juror) return null;
              const model = modelFor(r.jurorId);
              const dissentRate = r.sat ? r.dissents / r.sat : 0;
              const moveRate = r.couldMove ? r.moved / r.couldMove : 0;

              return (
                <li key={r.jurorId} className="a-rise" style={{ animationDelay: `${i * 30}ms` }}>
                  <Link
                    href={`/jury/${slugFor(juror)}`}
                    className="flex items-center gap-4 px-5 sm:px-6 py-4 hover:bg-white/5 transition-colors group"
                  >
                    <span className="size-11 shrink-0 rounded-full overflow-hidden ring-1 ring-white/10">
                      <JurorAvatar spec={juror.avatar} mood="decided" className="size-full" />
                    </span>

                    <span className="min-w-0 w-36 sm:w-44 shrink-0">
                      <span className="block display text-lg truncate group-hover:text-brass-lit transition-colors">
                        {juror.alias}
                      </span>
                      <span className="block mono text-[9px] tracking-[0.14em] uppercase text-muted/60 mt-0.5 truncate">
                        {juror.seat} · {model?.lab ?? "—"} · {r.sat} sat
                      </span>
                    </span>

                    <span className="flex-1 grid grid-cols-3 gap-3 sm:gap-5">
                      <span>
                        <span className="flex justify-between mono text-[9px] tracking-[0.12em] uppercase text-muted/70 mb-1">
                          <span>Dissents</span>
                          <span className="tabular-nums text-bone/80">{pct(dissentRate)}</span>
                        </span>
                        <Bar value={dissentRate} tone="var(--against)" />
                      </span>

                      <span>
                        <span className="flex justify-between mono text-[9px] tracking-[0.12em] uppercase text-muted/70 mb-1">
                          <span>Moves</span>
                          <span className="tabular-nums text-bone/80">
                            {r.couldMove ? pct(moveRate) : "—"}
                          </span>
                        </span>
                        <Bar value={moveRate} tone="var(--brass)" />
                      </span>

                      <span>
                        <span className="flex justify-between mono text-[9px] tracking-[0.12em] uppercase text-muted/70 mb-1">
                          <span>Confidence</span>
                          <span className="tabular-nums text-bone/80">{pct(r.confidence)}</span>
                        </span>
                        <Bar value={r.confidence} tone="var(--for)" />
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>

          <p className="mt-4 text-[13px] text-muted/70 leading-relaxed max-w-2xl">
            <span className="text-bone/80">Dissents</span> is how often a juror&apos;s finding was
            not the room&apos;s. <span className="text-bone/80">Moves</span> is how often they
            changed their mind in a second round, counted only over the cases that had one — a
            dash means they have never been asked twice.{" "}
            <span className="text-bone/80">Confidence</span> is their own average, which is worth
            reading against their dissent rate: a juror who is often alone and always certain is
            telling you something different from one who is often alone and says so.
          </p>

          {JURORS.length > record.jurors.length && (
            <p className="mt-3 mono text-[9px] tracking-[0.14em] uppercase text-muted/50">
              {JURORS.length - record.jurors.length} juror
              {JURORS.length - record.jurors.length === 1 ? "" : "s"} have not sat on a counted
              case
            </p>
          )}
        </>
      )}
    </main>
  );
}
