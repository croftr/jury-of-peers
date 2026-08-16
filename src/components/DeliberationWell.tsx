"use client";

import { useEffect, useState } from "react";
import type { JurorVerdict } from "@/lib/types";

const MURMURS = [
  "Seat IV re-reads the timeline for the third time…",
  "Someone asks who actually saw it happen.",
  "A long silence. Nobody fills it.",
  "The exhibits are pushed across the table again.",
  "Seat VIII refuses to move. The room waits.",
  "A chair scrapes. The question is put once more.",
  "Two jurors are arguing about what 'reasonable' means.",
  "The foreperson calls for a show of hands.",
  "One juror has not spoken for eleven minutes.",
  "The evidence is read back, line by line.",
];

/** The second time out is a different room: they have heard each other now. */
const SECOND_MURMURS = [
  "Seat II is reading the dissent again, more slowly.",
  "Someone concedes a point and immediately qualifies it.",
  "The minority is asked to put its case once more.",
  "A juror who was certain an hour ago is no longer certain.",
  "Two of them have found the same line in the file.",
  "The foreperson asks whether anyone has moved.",
  "Somebody says 'that is not what it says' and reaches for the exhibit.",
  "A long pause, and then: 'I take that point.'",
  "Seat XI has not changed a word and does not intend to.",
  "The question is put a second time. Nobody hurries.",
];

export default function DeliberationWell({
  active,
  round = 1,
  returned,
  failed,
  total,
  options,
  verdicts,
  onRecall,
}: {
  active: boolean;
  /** 1 is the silent round; 2 is after the room has been polled. */
  round?: 1 | 2;
  returned: number;
  failed: number;
  total: number;
  options: [string, string];
  verdicts: JurorVerdict[];
  /** Hangs up on every juror still out, so an unwanted run stops costing money. */
  onRecall?: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  const [murmur, setMurmur] = useState(0);

  // Mounted only while the jury is out, so the clock starts at zero each time.
  useEffect(() => {
    if (!active) return;
    const start = Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 500);
    return () => clearInterval(t);
  }, [active]);

  const murmurs = round === 2 ? SECOND_MURMURS : MURMURS;

  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setMurmur((m) => (m + 1) % murmurs.length), 3200);
    return () => clearInterval(t);
  }, [active, murmurs.length]);

  if (!active) return null;

  const counts = [0, 0];
  for (const v of verdicts) counts[v.choice]++;
  const pct = returned ? (counts[0] / returned) * 100 : 50;
  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  return (
    <div className="w-full max-w-2xl">
      <div className="panel rounded-xl px-5 py-4 relative overflow-hidden">
        {/* scanning light across the room */}
        <span className="pointer-events-none absolute inset-0 overflow-hidden">
          <span className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-brass/10 to-transparent a-sweep" />
        </span>

        <div className="relative flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="size-1.5 rounded-full bg-for" style={{ animation: "tick 1.1s ease-in-out infinite" }} />
            <span className="mono text-[12px] tracking-[0.28em] uppercase text-brass-lit a-flicker">
              {round === 2 ? "Jury reconsidering" : "Jury deliberating"}
            </span>
          </div>
          <span className="mono text-[13px] text-muted tabular-nums">
            {mm}:{ss} · {returned}/{total} returned
            {failed > 0 && <span className="text-for"> · {failed} lost</span>}
          </span>
        </div>

        {/* live split — only what has actually come back */}
        <div className="relative mt-4 h-1.5 rounded-full bg-white/6 overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 transition-all duration-700"
            style={{ width: `${pct}%`, background: "var(--for)" }}
          />
          <div
            className="absolute inset-y-0 right-0 transition-all duration-700"
            style={{ width: `${100 - pct}%`, background: "var(--against)" }}
          />
          {returned === 0 && <div className="absolute inset-0 bg-white/6" />}
        </div>

        <div className="relative mt-2 flex justify-between mono text-[11px] tracking-[0.14em] uppercase">
          <span style={{ color: "var(--for)" }}>
            {options[0]} · {counts[0]}
          </span>
          <span style={{ color: "var(--against)" }}>
            {counts[1]} · {options[1]}
          </span>
        </div>

        <p key={murmur} className="relative mt-4 text-center text-base text-muted italic a-rise display">
          {murmurs[murmur % murmurs.length]}
        </p>

        {/* The jurors still out are calls still running and still being billed.
            Sending the wrong case out should cost what has landed, not all of it. */}
        {onRecall && returned + failed < total && (
          <div className="relative mt-4 flex justify-center">
            <button
              type="button"
              onClick={onRecall}
              className="mono text-[10px] tracking-[0.22em] uppercase text-muted/60 hover:text-for
                         transition-colors underline underline-offset-4 decoration-dotted"
            >
              Call them back
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
