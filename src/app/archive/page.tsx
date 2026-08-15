"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { CaseSummary } from "@/lib/types";

/** "15 Aug 2026 · 14:22" — enough to tell two runs of the same case apart. */
function filedOn(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return `${at.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  })} · ${at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
}

export default function ArchivePage() {
  const [cases, setCases] = useState<CaseSummary[] | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** The ids the open modal is asking about — null when no modal is up. */
  const [pending, setPending] = useState<string[] | null>(null);
  const [striking, setStriking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/cases")
      .then(async (res) => {
        const payload = await res.json();
        if (!res.ok) throw new Error(payload?.error ?? "The archive could not be reached.");
        return payload as { enabled: boolean; cases: CaseSummary[] };
      })
      .then((payload) => {
        if (cancelled) return;
        setEnabled(payload.enabled);
        setCases(payload.cases);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "The archive could not be reached.");
        setCases([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  const strike = useCallback(async () => {
    if (!pending?.length) return;
    setStriking(true);
    setError(null);

    try {
      const res = await fetch("/api/cases", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: pending }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error ?? "The archive refused the deletion.");

      // Drop only what actually went, so a partial failure leaves the survivors
      // on screen rather than pretending they are gone.
      const gone = new Set<string>(payload.deleted ?? []);
      setCases((prev) => (prev ?? []).filter((c) => !gone.has(c.id)));
      setSelected((prev) => new Set([...prev].filter((id) => !gone.has(id))));
      if (payload.failed?.length) {
        setError(
          `${payload.failed.length} case${payload.failed.length === 1 ? "" : "s"} could not be struck from the record.`,
        );
      }
      setPending(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The archive refused the deletion.");
      setPending(null);
    } finally {
      setStriking(false);
    }
  }, [pending]);

  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !striking && setPending(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, striking]);

  const all = cases ?? [];
  const allSelected = all.length > 0 && selected.size === all.length;

  return (
    <main className="relative z-10 mx-auto w-full max-w-4xl px-4 sm:px-8 py-10 sm:py-14">
      <nav className="flex items-center justify-between mb-10">
        <Link
          href="/"
          className="mono text-[10px] tracking-[0.24em] uppercase text-muted hover:text-brass-lit transition-colors"
        >
          ← The court
        </Link>
        <Link
          href="/jury"
          className="mono text-[10px] tracking-[0.24em] uppercase text-muted hover:text-brass-lit transition-colors"
        >
          The jury →
        </Link>
      </nav>

      <header className="text-center mb-12">
        <p className="mono text-[10px] tracking-[0.42em] uppercase text-brass/70">
          The record
        </p>
        <h1 className="display text-[clamp(2.2rem,7vw,4rem)] leading-[0.95] mt-3">
          Past <span className="text-brass-lit">Cases</span>
        </h1>
        <div className="rule w-56 mx-auto mt-5" />
        <p className="mt-5 text-sm text-muted max-w-lg mx-auto leading-relaxed">
          Every case this court has decided, newest first. Open one to sit back
          down in the box and read the findings as they came in.
        </p>
      </header>

      {error && <p className="mb-6 text-center text-sm text-for">{error}</p>}

      {!error && !enabled && (
        <p className="text-center text-sm text-muted leading-relaxed max-w-md mx-auto">
          No archive is configured, so nothing has been kept. Set{" "}
          <span className="mono text-brass/80">CASES_BUCKET</span> in{" "}
          <span className="mono text-brass/80">.env.local</span> and cases will be
          filed here as they are decided.
        </p>
      )}

      {!error && enabled && cases === null && (
        <p className="text-center mono text-[10px] tracking-[0.26em] uppercase text-muted/60">
          Opening the record…
        </p>
      )}

      {!error && enabled && cases?.length === 0 && (
        <p className="text-center text-sm text-muted">
          Nothing filed yet. The first case you put to the jury will appear here.
        </p>
      )}

      {!!all.length && (
        <>
          <div className="flex items-center justify-between gap-4 mb-3 px-1">
            <button
              onClick={() => setSelected(allSelected ? new Set() : new Set(all.map((c) => c.id)))}
              className="mono text-[10px] tracking-[0.2em] uppercase text-muted hover:text-brass-lit transition-colors"
            >
              {allSelected ? "Select none" : "Select all"}
            </button>

            <div className="flex items-center gap-4">
              {selected.size > 0 && (
                <span className="mono text-[10px] tracking-[0.2em] uppercase text-muted/70 tabular-nums">
                  {selected.size} selected
                </span>
              )}
              <button
                onClick={() => setPending([...selected])}
                disabled={!selected.size}
                className="mono text-[10px] tracking-[0.2em] uppercase px-3 py-1.5 rounded-md border
                           border-for/40 text-for hover:bg-for/10 transition-colors
                           disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
              >
                Delete selected
              </button>
              <button
                onClick={() => setPending(all.map((c) => c.id))}
                className="mono text-[10px] tracking-[0.2em] uppercase px-3 py-1.5 rounded-md border
                           border-white/12 text-muted hover:text-for hover:border-for/40 transition-colors"
              >
                Delete all
              </button>
            </div>
          </div>

          <ul className="panel rounded-2xl overflow-hidden divide-y divide-white/8">
            {all.map((c, i) => {
              const tone = c.hung
                ? "var(--brass)"
                : c.majority === 0
                  ? "var(--for)"
                  : "var(--against)";
              const checked = selected.has(c.id);
              return (
                <li
                  key={c.id}
                  className="a-rise flex items-center"
                  style={{ animationDelay: `${i * 35}ms` }}
                >
                  {/* Outside the link, or picking a case would open it. */}
                  <label className="pl-5 sm:pl-6 py-4 cursor-pointer group/check">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(c.id)}
                      aria-label={`Select ${c.title}`}
                      className="sr-only"
                    />
                    <span
                      aria-hidden
                      className="grid place-items-center size-4 rounded-sm border transition-colors"
                      style={{
                        borderColor: checked ? "var(--brass)" : "rgba(255,255,255,0.2)",
                        background: checked ? "var(--brass)" : "transparent",
                      }}
                    >
                      {checked && (
                        <svg viewBox="0 0 12 12" className="size-3" fill="none">
                          <path
                            d="M2.5 6.2 5 8.6 9.5 3.6"
                            stroke="#12100c"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </span>
                  </label>

                  <Link
                    href={`/archive/${c.id}`}
                    className="flex-1 min-w-0 flex items-center gap-4 pl-4 pr-5 sm:pr-7 py-4
                               hover:bg-white/5 transition-colors group"
                  >
                    <span
                      className="w-1 h-10 rounded-full shrink-0"
                      style={{ background: tone, opacity: 0.75 }}
                    />

                    <span className="min-w-0 flex-1">
                      <span className="block display text-lg sm:text-xl truncate group-hover:text-brass-lit transition-colors">
                        {c.title}
                      </span>
                      <span className="block mono text-[9px] tracking-[0.18em] uppercase text-muted/60 mt-1 tabular-nums">
                        {filedOn(c.savedAt)} · {c.jurorCount} juror
                        {c.jurorCount === 1 ? "" : "s"}
                        {c.jurorCount < c.benchSize && ` of ${c.benchSize} seated`}
                      </span>
                    </span>

                    <span className="text-right shrink-0">
                      <span
                        className="block mono text-[10px] sm:text-xs tracking-[0.16em] uppercase"
                        style={{ color: tone }}
                      >
                        {c.verdict}
                      </span>
                      <span className="block mono text-[10px] text-muted/60 mt-1 tabular-nums">
                        {c.split}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {pending && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
          onClick={() => !striking && setPending(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="panel rounded-2xl w-full max-w-md overflow-hidden a-rise"
            style={{ boxShadow: "0 40px 120px -50px var(--for)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="h-px"
              style={{ background: "linear-gradient(90deg,transparent,var(--for),transparent)" }}
            />

            <div className="p-6 sm:p-8">
              <p className="mono text-[10px] tracking-[0.28em] uppercase text-for">
                Strike from the record
              </p>
              <h2 className="display text-3xl mt-2">
                {pending.length === 1
                  ? "Delete this case?"
                  : `Delete ${pending.length} cases?`}
              </h2>
              <p className="text-sm text-muted mt-4 leading-relaxed">
                {pending.length === 1
                  ? "The case, its evidence and every juror's reasoning are removed from the bucket."
                  : "Their evidence and every juror's reasoning are removed from the bucket."}{" "}
                This cannot be undone.
              </p>
            </div>

            <div className="grid grid-cols-2 border-t border-white/8">
              <button
                onClick={() => setPending(null)}
                disabled={striking}
                className="py-4 border-r border-white/8 mono text-[10px] tracking-[0.24em] uppercase
                           text-muted hover:text-bone hover:bg-white/5 transition-colors disabled:opacity-40"
              >
                {pending.length === 1 ? "Keep it" : "Keep them"}
              </button>
              <button
                onClick={strike}
                disabled={striking}
                className="py-4 mono text-[10px] tracking-[0.24em] uppercase text-for
                           hover:bg-for/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {striking ? "Striking…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
