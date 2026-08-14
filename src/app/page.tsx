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
import { getJuror } from "@/lib/jurors";
import { seatedJurors, useJuryConfig } from "@/lib/juryConfig";
import type { CaseFile, JurorExplanation, JurorVerdict } from "@/lib/types";

const EMPTY: CaseFile = {
  title: "",
  evidence: "",
  options: ["Guilty", "Not guilty"],
};

const WORDS = ["no", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"];

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
    const run = ++runId.current;
    setError(null);
    setVerdicts(new Map());
    setFailures(new Map());
    setExplanations(new Map());
    setAskErrors(new Map());
    setPhase("deliberating");
    boxRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

    // Twelve independent jurors, twelve independent models, twelve independent
    // requests. One slow or broken model costs only its own seat.
    const returned = await Promise.all(
      bench.map(async (juror): Promise<boolean> => {
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
          if (runId.current === run) {
            const verdict = payload as JurorVerdict;
            setVerdicts((prev) => new Map(prev).set(verdict.jurorId, verdict));
          }
          return true;
        } catch (err) {
          if (runId.current !== run) return false;
          const message = err instanceof Error ? err.message : "This juror could not be reached.";
          setFailures((prev) => new Map(prev).set(juror.id, message));
          return false;
        }
      }),
    );

    if (runId.current !== run) return;

    // Nobody returned — there is no verdict to present, so say why instead.
    if (!returned.some(Boolean)) {
      setError(
        "No juror returned a finding. Check that OPENROUTER_API_KEY is set and that the account has credit.",
      );
      setPhase("idle");
      return;
    }

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
    <main className="relative z-10 mx-auto w-full max-w-6xl px-4 sm:px-8 py-10 sm:py-16">
      <header className="text-center mb-12 sm:mb-16">
        <p className="mono text-[10px] tracking-[0.42em] uppercase text-brass/70">
          {WORDS[bench.length] ?? bench.length} mind{bench.length === 1 ? "" : "s"} · one finding
        </p>
        <h1 className="display text-[clamp(2.8rem,9vw,5.5rem)] leading-[0.95] mt-3">
          Jury of <span className="text-brass-lit a-flicker">Peers</span>
        </h1>
        <div className="rule w-64 mx-auto mt-5" />
        <p className="mt-5 text-sm sm:text-base text-muted max-w-xl mx-auto leading-relaxed">
          Submit a case, a dispute, or a debate. Your jurors — each with a different way of
          reading evidence, and each a different model — retire, deliberate, and return
          their findings independently. Then the room speaks as one.
        </p>

        {live !== null && (
          <div className="mt-6 flex justify-center">
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
              {live
                ? `${bench.length} live model${bench.length === 1 ? "" : "s"} · empanelled`
                : "Simulated jury · no API key set"}
            </span>
          </div>
        )}

        <div className="mt-5 flex justify-center">
          <Link
            href="/jury"
            className="mono text-[10px] tracking-[0.2em] uppercase text-muted hover:text-brass-lit
                       transition-colors underline underline-offset-4 decoration-dotted"
          >
            Choose your jury ({bench.length} of 12 seated)
          </Link>
        </div>
      </header>

      {phase === "idle" && (
        <div className="mb-14 a-rise">
          <CaseForm
            caseFile={caseFile}
            onChange={setCaseFile}
            onSubmit={charge}
            busy={false}
          />
          {error && (
            <p className="mt-4 text-center text-sm text-for">{error}</p>
          )}
        </div>
      )}

      {phase !== "idle" && (
        <div className="mb-10 text-center a-rise">
          <p className="mono text-[10px] tracking-[0.3em] uppercase text-muted">
            In the matter of
          </p>
          <p className="display text-2xl sm:text-3xl mt-1">
            {caseFile.title || "an untitled matter"}
          </p>
        </div>
      )}

      <div ref={boxRef} className="scroll-mt-8">
        <JuryBox
          jurors={bench}
          verdicts={verdicts}
          failures={failures}
          phase={phase}
          options={caseFile.options}
          onSelect={setSelected}
        >
          {phase === "deliberating" && (
            <DeliberationWell
              active
              returned={verdicts.size}
              failed={failures.size}
              total={bench.length}
              options={caseFile.options}
              verdicts={list}
            />
          )}
          {phase === "idle" && (
            <p className="mono text-[10px] tracking-[0.26em] uppercase text-muted/50 text-center">
              The jury is seated and waiting
            </p>
          )}
          {phase === "verdict" && (
            <p className="mono text-[10px] tracking-[0.22em] uppercase text-brass/70 text-center a-rise">
              Click any juror to read their reasoning — or ask them why
            </p>
          )}
        </JuryBox>
      </div>

      {phase === "verdict" && (
        <div className="mt-14">
          <VerdictPanel
            jurors={bench}
            caseFile={caseFile}
            tally={tally}
            verdicts={list}
            failures={failures}
            onReset={reset}
            onSelect={setSelected}
          />
        </div>
      )}

      <footer className="mt-20 text-center">
        <div className="rule w-40 mx-auto mb-5" />
        <p className="mono text-[9px] tracking-[0.24em] uppercase text-muted/50">
          Findings are generated by language models · no juror is a real person ·
          nothing here is legal advice
        </p>
      </footer>

      {selectedJuror && (
        <JurorDossier
          juror={selectedJuror}
          verdict={verdicts.get(selectedJuror.id)}
          failure={failures.get(selectedJuror.id)}
          caseFile={caseFile}
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
