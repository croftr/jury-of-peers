"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Gavel from "./Gavel";
import { MAX_EVIDENCE_BYTES, cannotRead, estimateCost, estimateTokens } from "@/lib/estimate";
import { caseMode } from "@/lib/types";
import type { CaseFile, CaseMode, Juror } from "@/lib/types";

/** What the extractor on /api/extract knows how to read. */
const ACCEPT = ".txt,.text,.md,.markdown,.csv,.tsv,.json,.log,.rtf,.pdf,.docx,text/plain";

/**
 * The four shapes a case can take.
 *
 * `blurb` is what the card says about itself; `note` is the operative rule the
 * jury will actually be charged with, shown once the shape is chosen. Kept to
 * one sentence apiece — they share a fixed slot, and the slot is only as tall
 * as the longest of them.
 */
const PRESETS: {
  key: string;
  label: string;
  blurb: string;
  note: string;
  options: [string, string];
  mode: CaseMode;
}[] = [
  {
    key: "criminal",
    label: "Criminal trial",
    blurb: "A charge to be proved, or not.",
    note: "Tried on the file alone. What is not in evidence is not proved, and the jury is asked to say so.",
    options: ["Guilty", "Not guilty"],
    mode: "trial",
  },
  {
    key: "civil",
    label: "Civil dispute",
    blurb: "Two parties, one wrong to apportion.",
    note: "Tried on the file alone. No charge to prove — the jury decides which side the record favours.",
    options: ["For the claimant", "For the respondent"],
    mode: "trial",
  },
  {
    key: "debate",
    label: "Debate",
    blurb: "A motion, argued both ways.",
    note: "Tried on the file alone. The motion is argued rather than proved: the better-made case wins.",
    options: ["Proposition", "Opposition"],
    mode: "trial",
  },
  {
    key: "decision",
    label: "Decision",
    blurb: "A choice to be made, weighed against what the jury knows.",
    note: "Not tried on the file alone. The jury also weighs what it already knows, and says which is which.",
    options: ["Option A", "Option B"],
    mode: "decision",
  },
];

const SAMPLE: CaseFile = {
  title: "The Matter of the Harbourside Warehouse Fire",
  options: ["Guilty", "Not guilty"],
  mode: "trial",
  evidence: `CHARGE: Arson of a commercial premises, 14 March, 02:40.

EVIDENCE FOR THE PROSECUTION
1. Accelerant residue (white spirit) found at three separate points of origin along the north wall.
2. The defendant's van was captured by an ANPR camera 400m from the site at 02:11 and again at 03:02.
3. The business had been insured for £1.2m eleven days before the fire, up from £300k.
4. A former employee testifies the defendant said the warehouse was "worth more as ash".

EVIDENCE FOR THE DEFENCE
5. The defendant states he drove to the harbour to collect a delivery that was later cancelled; the cancellation email is timestamped 01:55 and was not opened until 06:12.
6. The white spirit was stocked in bulk on site — 40 litres appear on the March inventory.
7. The former employee was dismissed for theft in January and has a pending claim against the defendant.
8. No forensic trace of the defendant was recovered from the point of entry, and the padlock shows tool marks inconsistent with the defendant's toolkit.`,
};

/**
 * A worked decision, to show what a brief is meant to look like.
 *
 * Deliberately not a case file: it states requirements and constraints rather
 * than evidence, and it leaves out everything the jury can be expected to know
 * already — running costs, reliability, what these hold their value at. Filling
 * those in is the jury's job under this charge, and a sample that pre-empted
 * them would teach the wrong shape.
 */
const SAMPLE_DECISION: CaseFile = {
  title: "The Matter of the Second Car",
  options: ["The estate", "The hatchback"],
  mode: "decision",
  evidence: `THE CHOICE
A: a five-year-old mid-size diesel estate, 68,000 miles, full service history, £11,500.
B: a two-year-old petrol hatchback, 19,000 miles, one owner, manufacturer warranty to next spring, £13,200.

WHAT IT IS FOR
- Second car in the household. School run and a supermarket trip most days.
- One long motorway drive a month, roughly 200 miles each way.
- Two children, one still in a car seat, and a large dog that travels in the boot.

CONSTRAINTS
- £13,500 is the ceiling, and it has to include the first year of insurance.
- Parking is on-street in a terraced row, so anything over about 4.6m is a nuisance.
- I keep cars a long time. The last one I ran for nine years.

WHAT I AM UNSURE ABOUT
- Whether the diesel's mileage is a problem at that age, given how it will be driven.
- Whether the warranty on B is worth the £1,700 difference.`,
};

/** 0 is the closed folder; 1–3 are the questions the clerk asks in order. */
type Step = 0 | 1 | 2 | 3;

/**
 * What the clerk asks, and how it is worded.
 *
 * A trial and a decision ask for materially different things at step three — a
 * record of what happened against a statement of what you want — so the wording
 * follows the charge rather than trying to cover both and describing neither.
 */
function stepsFor(mode: CaseMode): { n: 1 | 2 | 3; label: string; question: string; hint: string }[] {
  const decision = mode === "decision";
  return [
    {
      n: 1,
      label: "Name",
      question: "What is this case called?",
      hint: "A line the jury will see at the top of the file.",
    },
    {
      n: 2,
      label: "Type",
      question: "What are they deciding between?",
      hint: decision
        ? "Pick the shape of the case, then name the two things you are choosing between."
        : "Pick the shape of the case, then reword the two findings if you like.",
    },
    {
      n: 3,
      label: decision ? "Brief" : "Evidence",
      question: decision ? "What should the jury know?" : "What should the jury read?",
      hint: decision
        ? "What you are choosing between, what you need from it, and what would rule an option out."
        : "Statements, timelines, both sides — they know only what you give them.",
    },
  ];
}

export default function CaseForm({
  caseFile,
  onChange,
  onSubmit,
  busy,
  benchCount,
  bench = [],
  instructions = {},
  live,
  startAt = 0,
  retrial = false,
}: {
  caseFile: CaseFile;
  onChange: (c: CaseFile) => void;
  onSubmit: () => void;
  busy: boolean;
  benchCount?: number;
  /** The seated jury, for working out who can read this case and what it will cost. */
  bench?: Juror[];
  instructions?: Record<number, string>;
  /** Whether real models are wired up — a simulated jury costs nothing to warn about. */
  live?: boolean | null;
  /** Where the folder opens. A case that arrives already written opens at the evidence. */
  startAt?: Step;
  /** This case has been heard before and is being put to a new jury. */
  retrial?: boolean;
}) {
  const [step, setStep] = useState<Step>(startAt);
  // A case can arrive already written — a retrial, or a sample — so the shape it
  // arrived in is the one shown as chosen. Options first, since they identify a
  // preset exactly; failing that the charge, which at least narrows it.
  const [preset, setPreset] = useState(
    () =>
      PRESETS.find(
        (p) => p.options[0] === caseFile.options[0] && p.options[1] === caseFile.options[1],
      )?.key ??
      PRESETS.find((p) => p.mode === caseMode(caseFile.mode))?.key ??
      "criminal",
  );
  const [dragging, setDragging] = useState(false);
  const [reading, setReading] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [attached, setAttached] = useState<string[]>([]);
  const titleRef = useRef<HTMLInputElement>(null);
  const evidenceRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Each question takes the cursor when it comes up, so the whole file can be
  // filled in without touching the mouse.
  useEffect(() => {
    if (step === 1) titleRef.current?.focus();
    if (step === 3) evidenceRef.current?.focus();
  }, [step]);

  const mode = caseMode(caseFile.mode);
  const decision = mode === "decision";
  const steps = stepsFor(mode);
  // Reworded findings drop the preset to "custom", which still has a shape and
  // still has a charge — fall back to the mode's own so the note never blanks.
  const chosen = PRESETS.find((p) => p.key === preset) ?? PRESETS.find((p) => p.mode === mode)!;

  const titled = caseFile.title.trim().length > 0;
  const words = caseFile.evidence.trim() ? caseFile.evidence.trim().split(/\s+/).length : 0;
  const noJurors = benchCount === 0;
  const ready = words > 0 && !busy && !noJurors;

  /*
   * What this case will cost and who cannot read it, worked out before anyone
   * commits to it. Twelve context windows differ by two orders of magnitude —
   * Phi-4 holds sixteen thousand tokens where Gemini holds a million — so a long
   * upload silently costs several seats unless the court says so first.
   */
  const preflight = useMemo(() => {
    if (!words || !bench.length) return null;
    const excused = cannotRead(bench, caseFile, instructions);
    const tokens = estimateTokens(caseFile.evidence);
    return {
      excused,
      tokens,
      cost: estimateCost(bench, caseFile, instructions),
      // Bytes, not characters: the archive's ceiling is a byte ceiling.
      tooBigToArchive: new Blob([caseFile.evidence]).size > MAX_EVIDENCE_BYTES,
    };
  }, [caseFile, bench, instructions, words]);

  const open = (to: Step = 1) => setStep(to);
  const back = () => setStep((s) => (s > 1 ? ((s - 1) as Step) : s));
  const next = () => setStep((s) => (s < 3 ? ((s + 1) as Step) : s));

  /** Fill the folder with a worked example of one shape or the other. */
  const fill = (example: CaseFile, key: string) => {
    setPreset(key);
    onChange(example);
    setAttached([]);
    setUploadError(null);
    setStep(3);
  };

  const sample = () => fill(SAMPLE, "criminal");

  /**
   * Read dropped or chosen documents into the evidence.
   *
   * The server does the extracting — PDFs and Word files are not text until
   * something turns them into it — and each file is appended under its own
   * heading rather than replacing what is already in the file, so a case can be
   * built out of several exhibits.
   */
  const ingest = async (files: FileList | File[]) => {
    const list = [...files];
    if (!list.length || reading) return;

    setUploadError(null);
    let evidence = caseFile.evidence;
    const took: string[] = [];
    const refused: string[] = [];

    for (const file of list) {
      setReading(file.name);
      try {
        const body = new FormData();
        body.append("file", file);
        const res = await fetch("/api/extract", { method: "POST", body });
        const payload = await res.json();
        if (!res.ok) throw new Error(payload?.error ?? "That file could not be read.");

        // A lone file dropped into an empty box needs no label; anything that
        // sits beside other material gets one so the jury can tell it apart.
        const labelled = evidence.trim() || list.length > 1;
        const part = labelled ? `— ${payload.name} —\n${payload.text}` : payload.text;
        evidence = evidence.trim() ? `${evidence.trim()}\n\n${part}` : part;
        took.push(payload.truncated ? `${payload.name} (truncated)` : payload.name);
      } catch (err) {
        refused.push(`${file.name}: ${err instanceof Error ? err.message : "could not be read."}`);
      }
    }

    setReading(null);
    if (took.length) {
      onChange({ ...caseFile, evidence });
      setAttached((prev) => [...prev, ...took]);
    }
    if (refused.length) setUploadError(refused.join(" "));
  };

  return (
    <section className="panel rounded-2xl p-6 sm:p-8 relative overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-px rule" />

      {/* ── The closed folder ───────────────────────────────────────────── */}
      {step === 0 && (
        <div className="a-rise flex flex-col items-center text-center py-6 sm:py-10">
          <h2 className="display text-3xl sm:text-4xl">The case</h2>
          <p className="mt-3 text-[15px] text-muted max-w-sm leading-relaxed">
            {titled || words > 0
              ? "A file is open on the desk. Take it up where you left it, or start again."
              : "Three questions and the jury goes out: what the matter is called, what they are deciding, and what they get to read."}
          </p>

          {/* Full width on a phone so the label has the whole line to sit on,
              and the wide tracking eases off — letterspacing that reads as
              considered at 640px reads as a wrap at 375px. */}
          <button
            type="button"
            onClick={() => open(1)}
            className="group relative mt-7 w-full sm:w-auto px-4 py-4 sm:px-10 sm:py-5 rounded-xl
                       overflow-hidden border border-brass/45 hover:border-brass hover:bg-brass/10
                       transition-colors"
          >
            <span className="mono text-[13px] sm:text-[14px] tracking-[0.14em] sm:tracking-[0.28em] uppercase text-brass-lit inline-flex items-center justify-center gap-2.5 sm:gap-3">
              {/* shrink-0, or flexbox squeezes a square mark into a tall slot
                  and the gavel letterboxes itself into something lopsided. */}
              <Gavel className="gavel size-5 shrink-0" />
              <span className="text-balance">
                {titled || words > 0 ? "Take up the file" : "Enter a case to be heard"}
              </span>
            </span>
            <span className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity">
              <span className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-brass/25 to-transparent a-sweep" />
            </span>
          </button>

          <button
            type="button"
            onClick={sample}
            className="mt-5 mono text-[12px] tracking-[0.18em] uppercase text-muted hover:text-brass-lit
                       transition-colors underline underline-offset-4 decoration-dotted"
          >
            Or try a sample case
          </button>
        </div>
      )}

      {/* ── The three questions ─────────────────────────────────────────── */}
      {step > 0 && (
        <div>
          <header className="mb-6">
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="display text-2xl sm:text-3xl">The case</h2>
              <span className="mono text-[11px] tracking-[0.2em] uppercase text-muted tabular-nums">
                Step {step} of 3
              </span>
            </div>

            {retrial && (
              <p className="mt-3 mono text-[10px] tracking-[0.2em] uppercase text-brass/80">
                Retrial · this case has been heard before, and the verdicts will be set against
                each other
              </p>
            )}

            {decision && (
              <p className="mt-3 mono text-[10px] tracking-[0.2em] uppercase text-brass/80">
                Decision · the jury may draw on what they know, not only on what you write here
              </p>
            )}

            {/* Where the clerk is up to. Answered steps are clickable. */}
            <ol className="mt-4 flex items-center gap-2 sm:gap-3">
              {steps.map((s) => {
                const state = s.n === step ? "here" : s.n < step ? "done" : "ahead";
                return (
                  <li key={s.n} className="flex-1">
                    <button
                      type="button"
                      disabled={state === "ahead"}
                      onClick={() => setStep(s.n)}
                      className={`w-full text-left group ${state === "ahead" ? "cursor-default" : ""}`}
                    >
                      <span
                        className={`block h-px transition-colors ${state === "ahead" ? "bg-white/10" : "bg-brass/60"
                          }`}
                      />
                      <span
                        className={`mt-2 block mono text-[10px] sm:text-[11px] tracking-[0.1em] sm:tracking-[0.18em]
                                    uppercase whitespace-nowrap transition-colors ${state === "here"
                            ? "text-brass-lit"
                            : state === "done"
                              ? "text-muted group-hover:text-bone"
                              : "text-white/25"
                          }`}
                      >
                        {s.n}. {s.label}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </header>

          <div key={step} className="a-rise min-h-[19rem] sm:min-h-[21rem] flex flex-col">
            <h3 className="display text-2xl sm:text-[1.75rem] leading-snug">
              {steps[step - 1].question}
            </h3>
            <p className="mt-1.5 text-[14px] text-muted leading-relaxed">{steps[step - 1].hint}</p>

            {/* 1 — the name of the matter */}
            {step === 1 && (
              <div className="mt-6">
                <input
                  ref={titleRef}
                  value={caseFile.title}
                  onChange={(e) => onChange({ ...caseFile, title: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && titled) next();
                  }}
                  placeholder="The Matter of…"
                  className="w-full bg-black/30 border border-white/8 rounded-lg px-4 py-3.5 display text-xl sm:text-2xl
                             outline-none focus:border-brass/50 focus:bg-black/45 transition-colors placeholder:text-white/20"
                />
                <button
                  type="button"
                  onClick={sample}
                  className="mt-4 mono text-[11px] tracking-[0.18em] uppercase text-muted hover:text-brass-lit
                             transition-colors underline underline-offset-4 decoration-dotted"
                >
                  Fill it with a sample case
                </button>
              </div>
            )}

            {/* 2 — what they are choosing between */}
            {step === 2 && (
              <div className="mt-6">
                <div className="grid sm:grid-cols-2 gap-2.5">
                  {PRESETS.map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => {
                        setPreset(p.key);
                        onChange({
                          ...caseFile,
                          options: [...p.options] as [string, string],
                          mode: p.mode,
                        });
                      }}
                      className={`text-left px-4 py-3 rounded-lg border transition-colors ${preset === p.key
                        ? "border-brass/60 bg-brass/10"
                        : "border-white/10 hover:border-white/25"
                        }`}
                    >
                      <span
                        className={`mono text-[11px] tracking-[0.16em] uppercase block ${preset === p.key ? "text-brass-lit" : "text-muted"
                          }`}
                      >
                        {p.label}
                      </span>
                      <span className="mt-1 block text-[13px] leading-snug text-muted/70">{p.blurb}</span>
                    </button>
                  ))}
                </div>

                {/* What the chosen shape actually changes. Every preset carries one,
                    in a slot sized to the longest of them, so moving between the four
                    does not shunt the rest of the folder up and down the page. The
                    decision charge is said again in the header, because step three is
                    where this stops being visible. */}
                <div className="mt-4 border-l-2 border-brass/40 pl-3.5 min-h-[3.75rem] sm:min-h-[2.5rem]">
                  <p className="text-[13px] text-bone/70 leading-relaxed">{chosen.note}</p>
                  {decision && (
                    <button
                      type="button"
                      onClick={() => fill(SAMPLE_DECISION, "decision")}
                      className="mt-2 mono text-[11px] tracking-[0.18em] uppercase text-muted hover:text-brass-lit
                                 transition-colors underline underline-offset-4 decoration-dotted"
                    >
                      Fill it with a sample decision
                    </button>
                  )}
                </div>

                <p className="mt-6 mono text-[11px] tracking-[0.2em] uppercase text-muted/70">
                  {decision ? "The two options" : "The two findings"}
                </p>
                <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {[0, 1].map((i) => (
                    <div key={i} className="relative">
                      <span
                        className="absolute left-3 top-1/2 -translate-y-1/2 size-2 rounded-full"
                        style={{ background: i === 0 ? "var(--for)" : "var(--against)" }}
                      />
                      <input
                        value={caseFile.options[i]}
                        onChange={(e) => {
                          const options = [...caseFile.options] as [string, string];
                          options[i] = e.target.value;
                          setPreset("custom");
                          onChange({ ...caseFile, options });
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") next();
                        }}
                        className="w-full bg-black/30 border border-white/8 rounded-lg pl-8 pr-3 py-2.5 text-[15px]
                                   outline-none focus:border-brass/50 transition-colors"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 3 — the evidence itself */}
            {step === 3 && (
              <div
                className="mt-6 relative"
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={(e) => {
                  if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                  setDragging(false);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  void ingest(e.dataTransfer.files);
                }}
              >
                <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                  <button
                    type="button"
                    disabled={reading !== null}
                    onClick={() => fileRef.current?.click()}
                    className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-white/12
                               hover:border-brass/50 hover:bg-brass/5 transition-colors
                               disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <svg viewBox="0 0 24 24" fill="none" className="size-4 text-brass" aria-hidden>
                      <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 16V4" />
                        <path d="m7.5 8.5 4.5-4.5 4.5 4.5" />
                        <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
                      </g>
                    </svg>
                    <span className="mono text-[11px] tracking-[0.18em] uppercase text-bone">
                      {reading ? `Reading ${reading}…` : "Upload a document"}
                    </span>
                  </button>
                  <span className="mono text-[10px] tracking-[0.14em] uppercase text-muted/60">
                    PDF · Word (.docx) · text — or drop it in
                  </span>
                  <input
                    ref={fileRef}
                    type="file"
                    multiple
                    accept={ACCEPT}
                    className="hidden"
                    onChange={(e) => {
                      const files = e.target.files;
                      if (files?.length) void ingest(files);
                      // Cleared so the same file can be picked twice running.
                      e.target.value = "";
                    }}
                  />
                </div>

                {attached.length > 0 && (
                  <ul className="mb-3 flex flex-wrap gap-2">
                    {attached.map((name, i) => (
                      <li
                        key={`${name}-${i}`}
                        className="mono text-[10px] tracking-[0.12em] uppercase text-brass/80
                                   border border-brass/25 bg-brass/5 rounded-full px-3 py-1"
                      >
                        {name}
                      </li>
                    ))}
                  </ul>
                )}

                {uploadError && <p className="mb-3 text-[13px] text-for leading-relaxed">{uploadError}</p>}

                <textarea
                  ref={evidenceRef}
                  value={caseFile.evidence}
                  onChange={(e) => onChange({ ...caseFile, evidence: e.target.value })}
                  rows={9}
                  placeholder={
                    decision
                      ? "Set out what you are choosing between, what you need from it, and anything that would rule an option out — budget, must-haves, deal-breakers. Say what you are unsure about too. Or drop a PDF, Word file, or text file anywhere in this box."
                      : "Type or paste the evidence here — statements, timelines, both sides of the argument. Or drop a PDF, Word file, or text file anywhere in this box."
                  }
                  className="w-full bg-black/30 border border-white/8 rounded-lg px-4 py-3 text-[15px] leading-relaxed
                             outline-none focus:border-brass/50 focus:bg-black/45 transition-colors resize-y
                             placeholder:text-white/20"
                />

                {/* Only raised while something is over the box. */}
                {dragging && (
                  <div
                    className="pointer-events-none absolute inset-0 rounded-lg border-2 border-dashed border-brass/60
                               bg-ink/85 flex items-center justify-center"
                  >
                    <span className="mono text-[12px] tracking-[0.24em] uppercase text-brass-lit">
                      Release to file it
                    </span>
                  </div>
                )}
                <p className="mt-3 mono text-[11px] tracking-[0.16em] uppercase text-muted tabular-nums">
                  {words.toLocaleString()} words
                  <span className="text-muted/50">
                    {" · "}
                    {caseFile.title.trim() || "Untitled matter"}
                    {" · "}
                    {caseFile.options[0]} / {caseFile.options[1]}
                  </span>
                </p>
              </div>
            )}
          </div>

          {/* ── What this run will cost, and who cannot sit on it ──────── */}
          {step === 3 && preflight && (preflight.excused.length > 0 || preflight.tooBigToArchive || live) && (
            <div className="mt-5 space-y-2">
              {preflight.excused.length > 0 && (
                <div className="rounded-lg border border-brass/30 bg-brass/5 px-4 py-3">
                  <p className="mono text-[10px] tracking-[0.2em] uppercase text-brass mb-1.5">
                    {preflight.excused.length === 1
                      ? "One juror cannot read a file this long"
                      : `${preflight.excused.length} jurors cannot read a file this long`}
                  </p>
                  <p className="text-[13px] text-bone/75 leading-relaxed">
                    {preflight.excused
                      .map((e) => `${e.juror.alias} (${e.model.label}, ${
                        e.context >= 1000 ? `${Math.round(e.context / 1000)}k` : e.context
                      })`)
                      .join(", ")}
                    .{" "}
                    {preflight.excused.length === 1
                      ? "Their seat will be empty"
                      : "Their seats will be empty"}{" "}
                    and the verdict will rest on the rest of the room — shorten the evidence, or
                    excuse them on the jury page.
                  </p>
                </div>
              )}

              {preflight.tooBigToArchive && (
                <p className="text-[13px] text-muted leading-relaxed">
                  This case is too large to file in the archive. The jury will still hear it and
                  return a verdict; it just will not be remembered.
                </p>
              )}

              {live && !!preflight.cost && (
                <p className="mono text-[10px] tracking-[0.16em] uppercase text-muted/70 tabular-nums">
                  ≈ {preflight.tokens.toLocaleString()} tokens · about $
                  {preflight.cost.toFixed(preflight.cost < 0.01 ? 4 : 3)} for this round
                </p>
              )}
            </div>
          )}

          {/* ── Back, and the way forward ─────────────────────────────── */}
          <div className="mt-6 pt-5 border-t border-white/8 flex items-center justify-between gap-4">
            <button
              type="button"
              onClick={step === 1 ? () => setStep(0) : back}
              className="mono text-[12px] tracking-[0.2em] uppercase text-muted hover:text-bone transition-colors"
            >
              ← Back
            </button>

            {step < 3 ? (
              <button
                type="button"
                disabled={step === 1 && !titled}
                onClick={next}
                className="px-6 py-3 rounded-lg border border-brass/45 transition-colors
                           disabled:opacity-35 disabled:cursor-not-allowed
                           enabled:hover:border-brass enabled:hover:bg-brass/10"
              >
                <span className="mono text-[12px] tracking-[0.24em] uppercase text-brass-lit">
                  Next →
                </span>
              </button>
            ) : (
              <button
                type="button"
                disabled={!ready}
                onClick={onSubmit}
                title={noJurors ? "Empanel at least one juror to deliberate" : undefined}
                className="group relative px-7 py-3.5 rounded-lg overflow-hidden border border-brass/45
                           disabled:opacity-35 disabled:cursor-not-allowed
                           enabled:hover:border-brass enabled:hover:bg-brass/10 transition-colors"
              >
                <span className="mono text-[13px] tracking-[0.18em] sm:tracking-[0.28em] uppercase text-brass-lit inline-flex items-center gap-2.5">
                  <Gavel className="gavel size-4 shrink-0" />
                  {busy ? "Jury is out" : noJurors ? "No jurors seated" : "Send them out"}
                </span>
                {ready && (
                  <span className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <span className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-brass/25 to-transparent a-sweep" />
                  </span>
                )}
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
