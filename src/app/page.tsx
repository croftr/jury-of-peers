"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CaseForm from "@/components/CaseForm";
import DeliberationWell from "@/components/DeliberationWell";
import Gavel from "@/components/Gavel";
import JuryBox from "@/components/JuryBox";
import JurorDossier from "@/components/JurorDossier";
import RetrialComparison from "@/components/RetrialComparison";
import VerdictPanel from "@/components/VerdictPanel";
import type { Phase } from "@/components/JurorSeat";
import { tally as computeTally } from "@/lib/deliberate";
import { JURORS, getJuror } from "@/lib/jurors";
import { seatedJurors, useJuryConfig } from "@/lib/juryConfig";
import { clearRetrial, peekRetrial } from "@/lib/retrial";
import type {
  ArchivedCase,
  CaseFile,
  JurorExplanation,
  JurorFailure,
  JurorVerdict,
  RoomPosition,
} from "@/lib/types";

const EMPTY: CaseFile = {
  title: "",
  evidence: "",
  options: ["Guilty", "Not guilty"],
};

const WORDS = ["no", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"];

export default function Home() {
  /*
   * A case sent over from the archive to be tried again, read once as this
   * component initialises. A pure read, so React is free to run it twice; the
   * forgetting happens in an effect below, because that is the part that
   * touches the outside world.
   */
  const [retrial] = useState(peekRetrial);
  const [caseFile, setCaseFile] = useState<CaseFile>(retrial?.caseFile ?? EMPTY);
  const [phase, setPhase] = useState<Phase>("idle");
  const [verdicts, setVerdicts] = useState<Map<number, JurorVerdict>>(new Map());
  const [failures, setFailures] = useState<Map<number, string>>(new Map());
  /** Where the room stood before it went back out. Empty until it does. */
  const [firstRound, setFirstRound] = useState<Map<number, JurorVerdict>>(new Map());
  const [round, setRound] = useState<1 | 2>(1);
  /** A juror who could not be reached the second time. They keep their first finding. */
  const [heldOver, setHeldOver] = useState<Map<number, string>>(new Map());
  const [selected, setSelected] = useState<number | null>(null);
  const [explanations, setExplanations] = useState<Map<number, JurorExplanation>>(new Map());
  const [asking, setAsking] = useState<number | null>(null);
  const [askErrors, setAskErrors] = useState<Map<number, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<boolean | null>(null);
  const [filed, setFiled] = useState<"stored" | "skipped" | "failed" | null>(null);
  /** The archived case this run is a retrial of, once its file has been pulled. */
  const [prior, setPrior] = useState<ArchivedCase | null>(null);
  /** Set before the old file arrives, so the case is filed as a retrial either way. */
  const [priorId, setPriorId] = useState<string | null>(retrial?.priorId ?? null);
  /** A case that arrives already written opens at the evidence, not the closed folder. */
  const openAt = priorId ? 3 : 0;
  const { config } = useJuryConfig();
  const runId = useRef(0);
  const boxRef = useRef<HTMLDivElement>(null);
  /** The archive id of this case, so a second round replaces it rather than filing twice. */
  const filedId = useRef<string | null>(null);
  /**
   * Hangs up on every juror still out. Bumping `runId` only makes the court stop
   * *listening*; without this the calls run to completion and are billed for
   * findings that will never be shown.
   */
  const inFlight = useRef<AbortController | null>(null);

  /** End the current run, for real. Returns the controller the next one should use. */
  const recall = useCallback(() => {
    inFlight.current?.abort();
    const next = new AbortController();
    inFlight.current = next;
    return next;
  }, []);

  // A tab closed mid-deliberation should not leave twelve calls running.
  useEffect(() => () => inFlight.current?.abort(), []);

  const bench = useMemo(() => seatedJurors(config), [config]);
  const list = useMemo(() => [...verdicts.values()], [verdicts]);
  const tally = useMemo(() => computeTally(list), [list]);

  /*
   * Forget the handoff, and pull the old file to set the new verdict against.
   * The fetch is deliberately not blocking: the jury can go out without it, and
   * the comparison is only needed once there is something to compare.
   */
  useEffect(() => {
    if (!retrial) return;
    clearRetrial();

    let cancelled = false;
    fetch(`/api/cases/${encodeURIComponent(retrial.priorId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((record: ArchivedCase | null) => {
        if (!cancelled && record?.id) setPrior(record);
      })
      .catch(() => {
        // The comparison is a bonus. Losing it costs the retrial nothing.
      });
    return () => {
      cancelled = true;
    };
  }, [retrial]);

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

  /**
   * Commit the case to the archive.
   *
   * Called once when the room first speaks, and again if it goes back out — the
   * second call supersedes the first record rather than filing the same case
   * twice, so a case heard twice is one case in the book.
   */
  const file = useCallback(
    async (run: number, returned: JurorVerdict[], empty: JurorFailure[], first?: JurorVerdict[]) => {
      try {
        const res = await fetch("/api/cases", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            caseFile,
            bench: bench.map((j) => j.id),
            instructions: config.instructions,
            verdicts: returned,
            ...(first?.length ? { firstRound: first } : {}),
            ...(filedId.current ? { supersedes: filedId.current } : {}),
            // A retrial is a new record — a different jury on a different day —
            // so this keeps the lineage without replacing the old case.
            ...(priorId ? { retrialOf: priorId } : {}),
            failures: empty,
          }),
        });
        const payload = await res.json();
        if (!res.ok) throw new Error(payload?.error ?? "The case could not be archived.");
        if (typeof payload?.summary?.id === "string") filedId.current = payload.summary.id;
        if (runId.current === run) setFiled(payload?.stored ? "stored" : "skipped");
      } catch {
        // A case that cannot be filed is still a case that was decided — the
        // verdict stands whatever the archive does.
        if (runId.current === run) setFiled("failed");
      }
    },
    [caseFile, bench, config.instructions, priorId],
  );

  const charge = useCallback(async () => {
    if (bench.length === 0) {
      setError("No jurors are seated. Choose your jury to empanel at least one juror.");
      return;
    }

    const run = ++runId.current;
    const { signal } = recall();
    setError(null);
    setVerdicts(new Map());
    setFailures(new Map());
    setFirstRound(new Map());
    setHeldOver(new Map());
    setRound(1);
    setExplanations(new Map());
    setAskErrors(new Map());
    setFiled(null);
    filedId.current = null;
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
            signal,
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
          // We called them back; they did not fail. Nothing to report, and this
          // run is already abandoned.
          if (runId.current === run && !signal.aborted) {
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
    void file(run, returned, empty);

    // A beat of silence before the foreperson stands.
    setTimeout(() => {
      if (runId.current === run) setPhase("verdict");
    }, 900);
  }, [caseFile, bench, config.instructions, file, recall]);

  /**
   * Send the room back out.
   *
   * Every juror who returned a finding is shown what the others found and the
   * argument each of them gave, then asked once more. The seats go dark while
   * they think, exactly as they did the first time — but each juror's own first
   * finding is held, so a model that fails on the second asking keeps its vote
   * rather than costing the room a seat it already had.
   */
  const reconsider = useCallback(async () => {
    const first = [...verdicts.values()];
    // Nobody to hear is nobody to reconsider in front of.
    if (first.length < 2 || phase !== "verdict") return;

    const run = ++runId.current;
    const { signal } = recall();
    setFirstRound(new Map(verdicts));
    setRound(2);
    setVerdicts(new Map());
    setHeldOver(new Map());
    setExplanations(new Map());
    setAskErrors(new Map());
    setFiled(null);
    setError(null);
    setPhase("deliberating");
    boxRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

    // Only the finding and the argument travel. Which model held a view, what it
    // cost and how long it took are the court's business, not the room's.
    const positions: RoomPosition[] = first.map((v) => ({
      jurorId: v.jurorId,
      choice: v.choice,
      confidence: v.confidence,
      rationale: v.rationale,
      pivot: v.pivot,
    }));

    const settled = await Promise.all(
      first.map(async (own): Promise<JurorVerdict> => {
        try {
          const res = await fetch("/api/reconsider", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal,
            body: JSON.stringify({
              jurorId: own.jurorId,
              caseFile,
              own,
              // Everyone but this juror — nobody argues with themselves.
              room: positions.filter((p) => p.jurorId !== own.jurorId),
              bench: bench.length,
              instruction: config.instructions[own.jurorId],
            }),
          });
          const payload = await res.json();
          if (!res.ok) throw new Error(payload?.error ?? "This juror could not be reached.");
          const revised = payload as JurorVerdict;
          if (runId.current === run) {
            setVerdicts((prev) => new Map(prev).set(revised.jurorId, revised));
          }
          return revised;
        } catch (err) {
          const message = err instanceof Error ? err.message : "This juror could not be reached.";
          if (runId.current === run && !signal.aborted) {
            setVerdicts((prev) => new Map(prev).set(own.jurorId, own));
            setHeldOver((prev) => new Map(prev).set(own.jurorId, message));
          }
          return own;
        }
      }),
    );

    if (runId.current !== run) return;

    const empty = [...failures].map(([jurorId, message]) => ({ jurorId, message }));
    void file(run, settled, empty, first);

    setTimeout(() => {
      if (runId.current === run) setPhase("verdict");
    }, 900);
  }, [verdicts, phase, caseFile, bench, config.instructions, failures, file, recall]);

  const reset = useCallback(() => {
    runId.current++;
    inFlight.current?.abort();
    inFlight.current = null;
    setVerdicts(new Map());
    setFailures(new Map());
    setFirstRound(new Map());
    setHeldOver(new Map());
    setRound(1);
    setExplanations(new Map());
    setAskErrors(new Map());
    setPhase("idle");
    setError(null);
    setFiled(null);
    filedId.current = null;
    // Empanelling a new jury ends the retrial: the next case stands on its own,
    // and the folder closes again rather than opening on the old evidence.
    setPrior(null);
    setPriorId(null);
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
            {/* The gavel carries the court's state: lit while real models are
                answering, cold and unlit while the room is only rehearsing. */}
            <span
              className="relative shrink-0 inline-flex"
              title={
                live === null
                  ? undefined
                  : live
                    ? "Court in session — verdicts come from live models"
                    : "Rehearsal — no API key, so verdicts are simulated"
              }
            >
              <Gavel
                withBlock
                className={`size-8 sm:size-10 shrink-0 transition-colors duration-700 ${
                  live === null ? "text-brass/60" : live ? "gavel-live" : "gavel-cold"
                }`}
              />
              {live === true && <span className="gavel-ring" aria-hidden />}
              <span className="sr-only">
                {live === null
                  ? "Checking whether the court is sitting"
                  : live
                    ? "Court in session"
                    : "Rehearsal, no API key"}
              </span>
            </span>
            <div>
              <h1 className="display text-[clamp(1.8rem,5vw,3rem)] leading-none">
                Jury of <span className="text-brass-lit a-flicker">Peers</span>
              </h1>
              <p className="mono text-[11px] tracking-[0.3em] uppercase text-brass/60 mt-1.5">
                {WORDS[bench.length] ?? bench.length} mind{bench.length === 1 ? "" : "s"} · one finding
                {live === false && <span className="text-muted/60"> · rehearsal</span>}
              </p>
            </div>
          </div>
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
              className="mono text-[12px] tracking-[0.26em] uppercase text-brass/70 hover:text-brass-lit
                         transition-colors underline underline-offset-4 decoration-dotted"
            >
              The jury ({bench.length}/{JURORS.length})
            </Link>
          }
          wellControls={
            <span className="inline-flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
              <Link
                href="/archive"
                className="mono text-[12px] tracking-[0.26em] uppercase text-brass/70 hover:text-brass-lit
                           transition-colors underline underline-offset-4 decoration-dotted"
              >
                Past cases
              </Link>
              <span aria-hidden className="mono text-[12px] text-muted/30">
                ·
              </span>
              <Link
                href="/record"
                className="mono text-[12px] tracking-[0.26em] uppercase text-brass/70 hover:text-brass-lit
                           transition-colors underline underline-offset-4 decoration-dotted"
              >
                The record
              </Link>
            </span>
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
                bench={bench}
                instructions={config.instructions}
                live={live}
                startAt={openAt}
                retrial={Boolean(priorId)}
              />
              {error && <p className="mt-4 text-center text-base text-for">{error}</p>}
            </div>
          )}

          {phase === "deliberating" && (
            <div className="a-rise flex flex-col items-center">
              <p className="display text-2xl sm:text-3xl text-center mb-4">
                {caseFile.title || "An untitled matter"}
              </p>
              <DeliberationWell
                active
                round={round}
                returned={verdicts.size}
                failed={failures.size}
                total={round === 2 ? firstRound.size : bench.length}
                options={caseFile.options}
                verdicts={list}
                onRecall={reset}
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
                round={round}
                firstRound={firstRound}
                heldOver={heldOver}
                onReconsider={reconsider}
                onReset={reset}
                onSelect={setSelected}
              />
              {prior && (
                <RetrialComparison
                  prior={prior}
                  caseFile={caseFile}
                  jurors={bench}
                  tally={tally}
                  verdicts={list}
                  onSelect={setSelected}
                />
              )}
              {filed && (
                <p className="mt-4 text-center mono text-[11px] tracking-[0.2em] uppercase text-muted/60">
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
        <p className="mono text-[11px] tracking-[0.24em] uppercase text-muted/50">
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
          firstVerdict={firstRound.get(selectedJuror.id)}
          heldOver={heldOver.get(selectedJuror.id)}
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
