"use client";

import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import JurorAvatar from "@/components/JurorAvatar";
import { JURORS, getJurorBySlug, slugFor } from "@/lib/jurors";
import { MAX_INSTRUCTION, useJuryConfig } from "@/lib/juryConfig";
import { modelFor } from "@/lib/models";

const REASONING_NOTE: Record<string, string> = {
  off: "Internal reasoning switched off — this juror's thinking goes into its rationale, not a hidden channel.",
  low: "Reasons briefly before answering. This model requires reasoning and rejects the off switch.",
};

export default function JurorPage() {
  const params = useParams<{ slug: string }>();
  const juror = getJurorBySlug(params.slug);
  const { config, toggleSeat, setInstruction } = useJuryConfig();

  if (!juror) notFound();

  const model = modelFor(juror.id);
  const seated = config.seated.includes(juror.id);
  const lastSeated = seated && config.seated.length === 1;
  const instruction = config.instructions[juror.id] ?? "";

  const index = JURORS.findIndex((j) => j.id === juror.id);
  const previous = JURORS[(index - 1 + JURORS.length) % JURORS.length];
  const next = JURORS[(index + 1) % JURORS.length];

  return (
    <main className="relative z-10 mx-auto w-full max-w-3xl px-4 sm:px-8 py-10 sm:py-14">
      <nav className="flex items-center justify-between mb-10">
        <Link
          href="/jury"
          className="mono text-[10px] tracking-[0.24em] uppercase text-muted hover:text-brass-lit transition-colors"
        >
          ← The jury
        </Link>
        <Link
          href="/"
          className="mono text-[10px] tracking-[0.24em] uppercase text-muted hover:text-brass-lit transition-colors"
        >
          The court →
        </Link>
      </nav>

      <header className="flex flex-col sm:flex-row items-start gap-6">
        <div
          className="size-28 shrink-0 rounded-full overflow-hidden"
          style={{
            boxShadow: seated
              ? "0 0 40px -12px var(--brass), inset 0 0 0 2px rgba(201,162,39,0.55)"
              : "inset 0 0 0 1px rgba(255,255,255,0.14)",
          }}
        >
          <JurorAvatar spec={juror.avatar} className="size-full" />
        </div>

        <div className="min-w-0">
          <p className="mono text-[10px] tracking-[0.3em] uppercase text-brass/70">
            Seat {juror.seat} · {juror.archetype}
          </p>
          <h1 className="display text-[clamp(2.4rem,7vw,4rem)] leading-none mt-1">
            {juror.alias}
          </h1>
          <p className="text-sm sm:text-base text-muted mt-4 leading-relaxed max-w-xl">
            {juror.disposition}
          </p>

          <button
            onClick={() => toggleSeat(juror.id)}
            disabled={lastSeated}
            title={lastSeated ? "A jury needs at least one juror" : undefined}
            className={`mt-5 mono text-[10px] tracking-[0.2em] uppercase px-4 py-2.5 rounded-md border transition-colors ${
              seated
                ? "border-brass/50 text-brass-lit bg-brass/10 hover:bg-brass/20"
                : "border-white/12 text-muted hover:text-bone hover:border-white/30"
            } disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            {seated ? "Seated · click to excuse" : "Excused · click to seat"}
          </button>
        </div>
      </header>

      <div className="rule my-10" />

      {model && (
        <section>
          <h2 className="mono text-[10px] tracking-[0.28em] uppercase text-muted mb-4">
            The mind in this seat
          </h2>
          <dl className="panel rounded-xl divide-y divide-white/6">
            <Row label="Model">{model.label}</Row>
            <Row label="Identifier">
              <span className="mono text-xs break-all">{model.slug}</span>
            </Row>
            <Row label="Lab">{model.lab}</Row>
            <Row label="Context window">
              <span className="tabular-nums">{model.context.toLocaleString()} tokens</span>
              <span className="text-muted text-xs">
                {" "}
                (~{Math.round((model.context * 0.75) / 1000).toLocaleString()}k words)
              </span>
            </Row>
            <Row label="Price">
              <span className="tabular-nums">
                ${model.inPerM.toFixed(3)} in / ${model.outPerM.toFixed(3)} out per million
                tokens
              </span>
            </Row>
            <Row label="Cost per case">
              <span className="tabular-nums">
                ≈ ${((1200 * model.inPerM + 350 * model.outPerM) / 1_000_000).toFixed(5)}
              </span>
              <span className="text-muted text-xs"> on a case the size of the sample</span>
            </Row>
            <Row label="Reasoning">
              {model.reasoning ? REASONING_NOTE[model.reasoning] : "Not a reasoning model."}
            </Row>
          </dl>

          {model.context < 100_000 && (
            <p className="mt-4 text-xs text-muted leading-relaxed">
              <span className="text-brass">Smallest window on the bench.</span> A case file
              longer than roughly{" "}
              {Math.round((model.context * 0.75) / 1000).toLocaleString()}k words will be
              refused by this juror while the others still return findings — they will show
              as an empty seat rather than a verdict.
            </p>
          )}
        </section>
      )}

      <section className="mt-10">
        <h2 className="mono text-[10px] tracking-[0.28em] uppercase text-muted mb-2">
          Standing instruction
        </h2>
        <p className="text-sm text-muted mb-4 leading-relaxed">
          Added to this juror&apos;s system prompt for every case. It shapes how they weigh
          evidence — it does not let them abandon the two findings, invent facts, or ignore
          the record.
        </p>
        <textarea
          value={instruction}
          onChange={(e) => setInstruction(juror.id, e.target.value)}
          maxLength={MAX_INSTRUCTION}
          rows={5}
          placeholder="e.g. “Treat physical evidence as more reliable than testimony, and say so when the two conflict.”"
          className="w-full bg-black/30 border border-white/8 rounded-lg px-4 py-3 text-sm leading-relaxed
                     outline-none focus:border-brass/50 focus:bg-black/45 transition-colors resize-y
                     placeholder:text-white/20"
        />
        <p className="mt-2 mono text-[10px] tracking-[0.12em] uppercase text-muted/60 tabular-nums">
          {instruction.length} / {MAX_INSTRUCTION} · saves as you type
        </p>
      </section>

      <nav className="mt-12 flex items-center justify-between gap-4 border-t border-white/8 pt-6">
        <Link
          href={`/jury/${slugFor(previous)}`}
          className="group min-w-0 text-left"
        >
          <span className="mono text-[9px] tracking-[0.2em] uppercase text-muted">
            ← Seat {previous.seat}
          </span>
          <span className="display text-lg block truncate group-hover:text-brass-lit transition-colors">
            {previous.alias}
          </span>
        </Link>
        <Link href={`/jury/${slugFor(next)}`} className="group min-w-0 text-right">
          <span className="mono text-[9px] tracking-[0.2em] uppercase text-muted">
            Seat {next.seat} →
          </span>
          <span className="display text-lg block truncate group-hover:text-brass-lit transition-colors">
            {next.alias}
          </span>
        </Link>
      </nav>
    </main>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-4 px-4 sm:px-5 py-3">
      <dt className="mono text-[10px] tracking-[0.16em] uppercase text-muted sm:w-40 shrink-0">
        {label}
      </dt>
      <dd className="text-sm text-bone/90">{children}</dd>
    </div>
  );
}
