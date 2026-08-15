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
import type { CaseFile, JurorExplanation, JurorFailure, JurorVerdict } from "@/lib/types";

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

        <div className="mt-5 flex flex-wrap justify-center items-center gap-x-5 gap-y-2">
          <Link
            href="/jury"
            className="mono text-[10px] tracking-[0.2em] uppercase text-muted hover:text-brass-lit
                       transition-colors underline underline-offset-4 decoration-dotted"
          >
            Choose your jury ({bench.length} of 12 seated)
          </Link>
          <Link
            href="/archive"
            className="mono text-[10px] tracking-[0.2em] uppercase text-muted hover:text-brass-lit
                       transition-colors underline underline-offset-4 decoration-dotted"
          >
            Past cases
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
          {filed && (
            <p className="mt-4 text-center mono text-[9px] tracking-[0.2em] uppercase text-muted/60">
              {filed === "stored" ? (
                <>
                  Filed ·{" "}
                  <Link href="/archive" className="text-brass/80 hover:text-brass-lit transition-colors">
                    past cases
                  </Link>
                </>
              ) : filed === "failed" ? (
                "The archive refused this case — the verdict stands, but it was not recorded"
              ) : (
                "Not archived · no bucket configured"
              )}
            </p>
          )}
        </div>
      )}

      <footer className="mt-20 text-center">
        <div className="rule w-40 mx-auto mb-5" />
        <p className="mono text-[9px] tracking-[0.24em] uppercase text-muted/50">
          Findings are generated by language models · no juror is a real person ·
          nothing here is legal advice
        </p>
        <a
          href="/logout"
          className="mono text-[9px] tracking-[0.24em] uppercase text-muted/50 hover:text-brass-lit
                     transition-colors underline underline-offset-4 decoration-dotted mt-3 inline-block"
        >
          Leave the court
        </a>
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
