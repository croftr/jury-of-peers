"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CaseForm from "@/components/CaseForm";
import DeliberationWell from "@/components/DeliberationWell";
import JuryBox from "@/components/JuryBox";
import JurorDossier from "@/components/JurorDossier";
import VerdictPanel from "@/components/VerdictPanel";
import type { Phase } from "@/components/JurorSeat";
import { tally as computeTally } from "@/lib/deliberate";
import { JURORS, getJuror } from "@/lib/jurors";
import { seatedJurors, useJuryConfig } from "@/lib/juryConfig";
import type { CaseFile, JurorExplanation, JurorFailure, JurorVerdict } from "@/lib/types";

const EMPTY: CaseFile = {
  title: "",
  evidence: "",
  options: ["Guilty", "Not guilty"],
};

const WORDS = ["no", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"];

/** The court's mark. Head, handle, and the block it lands on. */
function Gavel({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" className={className} aria-hidden>
      <g stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <rect x="8" y="7" width="15" height="10" rx="2.5" transform="rotate(-32 8 7)" />
        <path d="M20.5 17.5 32 29" />
        <path d="M9 38h26" />
        <path d="M12 34h20" />
      </g>
    </svg>
  );
}

export default function Home() {
  const [caseFile, setCaseFile] = useState<CaseFile>(EMPTY);
  const [phase, setPhase] = useState<Phase>("idle");
  const [verdicts, setVerdicts] = useState<Map<number, JurorVerdict>>(new Map());
  const [failures, setFailures] = useState<Map<number, string>>(new Map());
  const [selected, setSelected] = useState<number | null>(null);
  const [explanations, setExplanations] = useState<Map<number, JurorExplanation>>(new Map());
  const [asking, setAsking] = useState<number | null>(null);
  const [askErrors, setAskErrors] = useState<Map<number, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<boolean | null>(null);
  const [filed, setFiled] = useState<"stored" | "skipped" | "failed" | null>(null);
  const { config } = useJuryConfig();
  const runId = useRef(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const bench = useMemo(() => seatedJurors(config), [config]);
  const list = useMemo(() => [...verdicts.values()], [verdicts]);
  const tally = useMemo(() => computeTally(list), [list]);

  // Whether real models are wired up, so the UI can say so before anyone commits
  // a case to a jury that turns out to be simulated.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/status")
      .then((r) => r.json())
      .then((d) => !cancelled && setLive(Boolean(d?.live)))
      .catch(() => !cancelled && setLive(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const charge = useCallback(async () => {
    if (bench.length === 0) {
      setError("No jurors are seated. Choose your jury to empanel at least one juror.");
      return;
    }

    const run = ++runId.current;
    setError(null);
    setVerdicts(new Map());
    setFailures(new Map());
    setExplanations(new Map());
    setAskErrors(new Map());
    setFiled(null);
    setPhase("deliberating");
    boxRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

    // Twelve independent jurors, twelve independent models, twelve independent
    // requests. One slow or broken model costs only its own seat.
    const settled = await Promise.all(
      bench.map(async (juror): Promise<JurorVerdict | JurorFailure> => {
        try {
          const res = await fetch("/api/verdict", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jurorId: juror.id,
              caseFile,
              bench: bench.length,
              instruction: config.instructions[juror.id],
            }),
          });
          const payload = await res.json();
          if (!res.ok) throw new Error(payload?.error ?? "This juror could not be reached.");
          const verdict = payload as JurorVerdict;
          if (runId.current === run) {
            setVerdicts((prev) => new Map(prev).set(verdict.jurorId, verdict));
          }
          return verdict;
        } catch (err) {
          const message = err instanceof Error ? err.message : "This juror could not be reached.";
          if (runId.current === run) {
            setFailures((prev) => new Map(prev).set(juror.id, message));
          }
          return { jurorId: juror.id, message };
        }
      }),
    );

    if (runId.current !== run) return;

    const returned = settled.filter((r): r is JurorVerdict => "choice" in r);
    const empty = settled.filter((r): r is JurorFailure => !("choice" in r));

    // Nobody returned — there is no verdict to present, so say why instead.
    if (!returned.length) {
      setError(
        "No juror returned a finding. Check that OPENROUTER_API_KEY is set and that the account has credit.",
      );
      setPhase("idle");
      return;
    }

    // The room has spoken, so the case goes in the book. Filed from here rather
    // than from the verdict panel: this is the one place that has seen the whole
    // run, and it happens once, not on every re-render of the result.
    void (async () => {
      try {
        const res = await fetch("/api/cases", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            caseFile,
            bench: bench.map((j) => j.id),
            instructions: config.instructions,
            verdicts: returned,
            failures: empty,
          }),
        });
        const payload = await res.json();
        if (!res.ok) throw new Error(payload?.error ?? "The case could not be archived.");
        if (runId.current === run) setFiled(payload?.stored ? "stored" : "skipped");
      } catch {
        // A case that cannot be filed is still a case that was decided — the
        // verdict stands whatever the archive does.
        if (runId.current === run) setFiled("failed");
      }
    })();

    // A beat of silence before the foreperson stands.
    setTimeout(() => {
      if (runId.current === run) setPhase("verdict");
    }, 900);
  }, [caseFile, bench, config.instructions]);

  const reset = useCallback(() => {
    runId.current++;
    setVerdicts(new Map());
    setFailures(new Map());
    setExplanations(new Map());
    setAskErrors(new Map());
    setPhase("idle");
    setError(null);
    setFiled(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  /** Put a follow-up question to one juror who has already returned a finding. */
  const ask = useCallback(
    async (jurorId: number, question: string) => {
      const verdict = verdicts.get(jurorId);
      if (!verdict || asking !== null) return;

      setAsking(jurorId);
      setAskErrors((prev) => {
        const next = new Map(prev);
        next.delete(jurorId);
        return next;
      });

      try {
        const res = await fetch("/api/explain", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jurorId,
            caseFile,
            verdict,
            question,
            bench: bench.length,
            instruction: config.instructions[jurorId],
          }),
        });
        const payload = await res.json();
        if (!res.ok) throw new Error(payload?.error ?? "This juror could not be reached.");
        setExplanations((prev) => new Map(prev).set(jurorId, payload as JurorExplanation));
      } catch (err) {
        const message = err instanceof Error ? err.message : "This juror could not be reached.";
        setAskErrors((prev) => new Map(prev).set(jurorId, message));
      } finally {
        setAsking(null);
      }
    },
    [verdicts, asking, caseFile, bench, config.instructions],
  );

  const selectedJuror = selected != null ? getJuror(selected) : undefined;

  return (
    <main className="relative z-10 mx-auto w-full max-w-6xl px-3 sm:px-8 py-5 sm:py-8">
      {/* The bench: title on the left, the state of the room on the right. */}
      <header className="mb-5 sm:mb-7">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <div className="flex items-center gap-3">
            <Gavel className="size-8 sm:size-10 text-brass shrink-0" />
            <div>
              <h1 className="display text-[clamp(1.8rem,5vw,3rem)] leading-none">
                Jury of <span className="text-brass-lit a-flicker">Peers</span>
              </h1>
              <p className="mono text-[9px] tracking-[0.3em] uppercase text-brass/60 mt-1.5">
                {WORDS[bench.length] ?? bench.length} mind{bench.length === 1 ? "" : "s"} · one finding
              </p>
            </div>
          </div>

          {live !== null && (
            <span
              className="mono text-[9px] tracking-[0.22em] uppercase px-3 py-1.5 rounded-full border inline-flex items-center gap-2"
              style={{
                borderColor: live ? "rgba(55,183,156,0.4)" : "rgba(201,162,39,0.35)",
                color: live ? "var(--against)" : "var(--brass)",
              }}
            >
              <span
                className="size-1.5 rounded-full"
                style={{
                  background: "currentColor",
                  animation: live ? "tick 1.6s ease-in-out infinite" : undefined,
                }}
              />
              {live ? "Court in session" : "Rehearsal · no API key"}
            </span>
          )}
        </div>
        <div className="rule mt-4" />
      </header>

      <div ref={boxRef} className="scroll-mt-4">
        <JuryBox
          jurors={bench}
          verdicts={verdicts}
          failures={failures}
          phase={phase}
          options={caseFile.options}
          onSelect={setSelected}
          controls={
            <Link
              href="/jury"
              className="mono text-[10px] tracking-[0.26em] uppercase text-brass/70 hover:text-brass-lit
                         transition-colors underline underline-offset-4 decoration-dotted"
            >
              The jury ({bench.length}/{JURORS.length})
            </Link>
          }
          wellControls={
            <Link
              href="/archive"
              className="mono text-[10px] tracking-[0.26em] uppercase text-brass/70 hover:text-brass-lit
                         transition-colors underline underline-offset-4 decoration-dotted"
            >
              Past cases
            </Link>
          }
        >
          {phase === "idle" && (
            <div className="a-rise">
              <CaseForm
                caseFile={caseFile}
                onChange={setCaseFile}
                onSubmit={charge}
                busy={false}
                benchCount={bench.length}
              />
              {error && <p className="mt-4 text-center text-sm text-for">{error}</p>}
            </div>
          )}

          {phase === "deliberating" && (
            <div className="a-rise flex flex-col items-center">
              <p className="display text-2xl sm:text-3xl text-center mb-4">
                {caseFile.title || "An untitled matter"}
              </p>
              <DeliberationWell
                active
                returned={verdicts.size}
                failed={failures.size}
                total={bench.length}
                options={caseFile.options}
                verdicts={list}
              />
            </div>
          )}

          {phase === "verdict" && (
            <div className="a-rise">
              <VerdictPanel
                jurors={bench}
                caseFile={caseFile}
                tally={tally}
                verdicts={list}
                failures={failures}
                onReset={reset}
                onSelect={setSelected}
              />
              {filed && (
                <p className="mt-4 text-center mono text-[9px] tracking-[0.2em] uppercase text-muted/60">
                  {filed === "stored" ? (
                    <Link href="/archive" className="text-brass/80 hover:text-brass-lit transition-colors">
                      Filed with the past cases
                    </Link>
                  ) : filed === "failed" ? (
                    <span className="text-for/70">The archive would not take this one</span>
                  ) : (
                    "Not archived · no bucket configured"
                  )}
                </p>
              )}
            </div>
          )}
        </JuryBox>
      </div>

      <footer className="mt-12 text-center">
        <div className="rule w-40 mx-auto mb-4" />
        <p className="mono text-[9px] tracking-[0.24em] uppercase text-muted/50">
          Twelve models · no juror is a real person ·{" "}
          <a
            href="/logout"
            className="hover:text-brass-lit transition-colors underline underline-offset-4 decoration-dotted"
          >
            leave the court
          </a>
        </p>
      </footer>

      {selectedJuror && (
        <JurorDossier
          juror={selectedJuror}
          verdict={verdicts.get(selectedJuror.id)}
          failure={failures.get(selectedJuror.id)}
          caseFile={caseFile}
          instruction={config.instructions[selectedJuror.id]}
          explanation={explanations.get(selectedJuror.id)}
          asking={asking === selectedJuror.id}
          askError={askErrors.get(selectedJuror.id)}
          onAsk={ask}
          onClose={() => setSelected(null)}
        />
      )}
    </main>
  );
}
