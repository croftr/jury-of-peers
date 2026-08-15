"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import JuryBox from "@/components/JuryBox";
import JurorDossier from "@/components/JurorDossier";
import VerdictPanel from "@/components/VerdictPanel";
import type { ArchivedCase } from "@/lib/types";

export default function ArchivedCasePage() {
  const params = useParams<{ id: string }>();
  const [record, setRecord] = useState<ArchivedCase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/cases/${encodeURIComponent(params.id)}`)
      .then(async (res) => {
        const payload = await res.json();
        if (!res.ok) throw new Error(payload?.error ?? "This case could not be opened.");
        return payload as ArchivedCase;
      })
      .then((payload) => !cancelled && setRecord(payload))
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "This case could not be opened.");
      });
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  // The seat components read from maps, exactly as they do during a live case —
  // so a case out of the archive renders through the same path it was decided on.
  const verdicts = useMemo(
    () => new Map((record?.verdicts ?? []).map((v) => [v.jurorId, v])),
    [record],
  );
  const failures = useMemo(
    () => new Map((record?.failures ?? []).map((f) => [f.jurorId, f.message])),
    [record],
  );

  const selectedJuror = record?.jurors.find((j) => j.id === selected);

  return (
    <main className="relative z-10 mx-auto w-full max-w-6xl px-4 sm:px-8 py-10 sm:py-14">
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

      {error && <p className="text-center text-sm text-for">{error}</p>}

      {!error && !record && (
        <p className="text-center mono text-[10px] tracking-[0.26em] uppercase text-muted/60">
          Pulling the file…
        </p>
      )}

      {record && (
        <>
          <header className="text-center mb-10 a-rise">
            <p className="mono text-[10px] tracking-[0.3em] uppercase text-muted">
              In the matter of
            </p>
            <h1 className="display text-[clamp(2rem,6vw,3.5rem)] leading-tight mt-1">
              {record.caseFile.title || "an untitled matter"}
            </h1>
            <p className="mono text-[9px] tracking-[0.2em] uppercase text-muted/60 mt-3 tabular-nums">
              Decided {new Date(record.savedAt).toLocaleString()}
            </p>
          </header>

          <section className="panel rounded-2xl overflow-hidden mb-12 a-rise">
            <div className="px-6 sm:px-8 py-6">
              <p className="mono text-[10px] tracking-[0.24em] uppercase text-muted mb-3">
                The evidence, as it was put
              </p>
              <div className="text-sm leading-relaxed text-bone/85 whitespace-pre-wrap max-h-96 overflow-y-auto">
                {record.caseFile.evidence}
              </div>
            </div>
            <div className="border-t border-white/8 px-6 sm:px-8 py-4 flex flex-wrap gap-x-8 gap-y-2">
              <span className="mono text-[9px] tracking-[0.2em] uppercase text-muted">
                Findings open to the jury ·{" "}
                <span className="text-for">{record.caseFile.options[0]}</span> or{" "}
                <span className="text-against">{record.caseFile.options[1]}</span>
              </span>
            </div>
          </section>

          <JuryBox
            jurors={record.jurors}
            verdicts={verdicts}
            failures={failures}
            phase="verdict"
            options={record.caseFile.options}
            onSelect={setSelected}
          >
            <p className="mono text-[10px] tracking-[0.22em] uppercase text-brass/70 text-center">
              Click any juror to read the reasoning they gave
            </p>
          </JuryBox>

          <div className="mt-14">
            <VerdictPanel
              jurors={record.jurors}
              caseFile={record.caseFile}
              tally={record.tally}
              verdicts={record.verdicts}
              failures={failures}
              onReset={() => history.back()}
              resetLabel="Back to the record"
              onSelect={setSelected}
            />
          </div>

          {selectedJuror && (
            <JurorDossier
              juror={selectedJuror}
              verdict={verdicts.get(selectedJuror.id)}
              failure={failures.get(selectedJuror.id)}
              caseFile={record.caseFile}
              instruction={record.instructions[selectedJuror.id]}
              onClose={() => setSelected(null)}
            />
          )}
        </>
      )}
    </main>
  );
}
