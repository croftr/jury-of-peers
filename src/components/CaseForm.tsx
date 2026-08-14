"use client";

import { useState } from "react";
import type { CaseFile } from "@/lib/types";

const PRESETS: { key: string; label: string; options: [string, string] }[] = [
  { key: "criminal", label: "Criminal trial", options: ["Guilty", "Not guilty"] },
  { key: "civil", label: "Civil dispute", options: ["For the claimant", "For the respondent"] },
  { key: "debate", label: "Debate", options: ["Proposition", "Opposition"] },
];

const SAMPLE: CaseFile = {
  title: "The Matter of the Harbourside Warehouse Fire",
  options: ["Guilty", "Not guilty"],
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

export default function CaseForm({
  caseFile,
  onChange,
  onSubmit,
  busy,
}: {
  caseFile: CaseFile;
  onChange: (c: CaseFile) => void;
  onSubmit: () => void;
  busy: boolean;
}) {
  const [preset, setPreset] = useState("criminal");
  const words = caseFile.evidence.trim() ? caseFile.evidence.trim().split(/\s+/).length : 0;
  const ready = words > 0 && !busy;

  return (
    <section className="panel rounded-2xl p-6 sm:p-8 relative overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-px rule" />

      <header className="flex items-baseline justify-between gap-4 mb-6">
        <div>
          <p className="mono text-[10px] tracking-[0.32em] text-brass/70 uppercase">
            Exhibit intake
          </p>
          <h2 className="display text-3xl mt-1">The case file</h2>
        </div>
        <button
          type="button"
          onClick={() => {
            setPreset("criminal");
            onChange(SAMPLE);
          }}
          className="mono text-[10px] tracking-[0.18em] uppercase text-muted hover:text-brass-lit transition-colors underline underline-offset-4 decoration-dotted"
        >
          Load sample
        </button>
      </header>

      <label className="block mb-5">
        <span className="mono text-[10px] tracking-[0.24em] uppercase text-muted">
          Matter
        </span>
        <input
          value={caseFile.title}
          onChange={(e) => onChange({ ...caseFile, title: e.target.value })}
          placeholder="Untitled matter"
          className="mt-2 w-full bg-black/30 border border-white/8 rounded-lg px-4 py-3 display text-xl
                     outline-none focus:border-brass/50 focus:bg-black/45 transition-colors placeholder:text-white/20"
        />
      </label>

      <div className="mb-5">
        <span className="mono text-[10px] tracking-[0.24em] uppercase text-muted">
          The question before the jury
        </span>
        <div className="mt-2 flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => {
                setPreset(p.key);
                onChange({ ...caseFile, options: [...p.options] as [string, string] });
              }}
              className={`mono text-[10px] tracking-[0.16em] uppercase px-3 py-2 rounded-md border transition-colors ${
                preset === p.key
                  ? "border-brass/60 text-brass-lit bg-brass/10"
                  : "border-white/10 text-muted hover:text-bone hover:border-white/25"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
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
                className="w-full bg-black/30 border border-white/8 rounded-lg pl-8 pr-3 py-2.5 text-sm
                           outline-none focus:border-brass/50 transition-colors"
              />
            </div>
          ))}
        </div>
      </div>

      <label className="block">
        <span className="mono text-[10px] tracking-[0.24em] uppercase text-muted">
          Evidence, testimony &amp; exhibits
        </span>
        <textarea
          value={caseFile.evidence}
          onChange={(e) => onChange({ ...caseFile, evidence: e.target.value })}
          rows={12}
          placeholder="Paste the facts of the matter. Statements, documents, timelines, arguments on both sides — the jury reads exactly what you give it and nothing more."
          className="mt-2 w-full bg-black/30 border border-white/8 rounded-lg px-4 py-3 text-sm leading-relaxed
                     outline-none focus:border-brass/50 focus:bg-black/45 transition-colors resize-y
                     placeholder:text-white/20"
        />
      </label>

      <div className="mt-6 flex items-center justify-between gap-4">
        <span className="mono text-[10px] tracking-[0.16em] uppercase text-muted">
          {words.toLocaleString()} words submitted
        </span>
        <button
          type="button"
          disabled={!ready}
          onClick={onSubmit}
          className="group relative px-7 py-3.5 rounded-lg overflow-hidden border border-brass/45
                     disabled:opacity-35 disabled:cursor-not-allowed
                     enabled:hover:border-brass enabled:hover:bg-brass/10 transition-colors"
        >
          <span className="mono text-[11px] tracking-[0.28em] uppercase text-brass-lit">
            {busy ? "Jury is out" : "Charge the jury"}
          </span>
          {ready && (
            <span className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity">
              <span className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-brass/25 to-transparent a-sweep" />
            </span>
          )}
        </button>
      </div>
    </section>
  );
}
