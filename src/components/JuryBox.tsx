"use client";

import JurorSeat, { type Phase } from "./JurorSeat";
import type { Juror, JurorVerdict } from "@/lib/types";

/**
 * The jury sits together in its own box to the left of the case, the way it
 * would in a real room: three to a row behind a brass rail, everyone facing the
 * evidence. Narrow screens drop the box above the case file rather than beside
 * it, and the seats simply wrap wider.
 */
export default function JuryBox({
  jurors,
  verdicts,
  failures,
  phase,
  options,
  onSelect,
  controls,
  wellControls,
  children,
}: {
  jurors: Juror[];
  verdicts: Map<number, JurorVerdict>;
  failures: Map<number, string>;
  phase: Phase;
  options: [string, string];
  onSelect: (jurorId: number) => void;
  /** Anything that acts on the jury as a whole — sits above the box. */
  controls?: React.ReactNode;
  /** The same slot on the other side, above the case. Keeps the two tops level. */
  wellControls?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const seated = jurors.length;

  return (
    <section className="courtroom relative">
      {/* Wide enough for four fixed-size seats a row — the seats never shrink,
          so the box is sized to them rather than the other way round. */}
      <div className="ct-jury lg:w-[23rem]">
        {controls && <div className="mb-3 px-1 text-center">{controls}</div>}

        <div className="panel rounded-2xl px-2 sm:px-3 pt-4 pb-5 relative overflow-hidden">
          {/* the light over the box, and the rail they sit behind */}
          <div
            className="absolute inset-x-6 -top-10 h-24 pointer-events-none"
            style={{
              background:
                "radial-gradient(closest-side, rgba(201,162,39,0.16), transparent 75%)",
            }}
          />
          <div className="rail mx-2 mb-4" />

          <div className="flex flex-wrap justify-center gap-x-1.5 gap-y-3">
            {jurors.map((juror, i) => (
              <div key={juror.id} className="a-rise" style={{ animationDelay: `${i * 55}ms` }}>
                <JurorSeat
                  juror={juror}
                  verdict={verdicts.get(juror.id)}
                  failure={failures.get(juror.id)}
                  phase={phase}
                  options={options}
                  index={i}
                  onSelect={() => onSelect(juror.id)}
                />
              </div>
            ))}
          </div>

          {seated > 0 && (
            <p className="mono text-[11px] tracking-[0.18em] uppercase text-muted/55 text-center mt-4">
              {phase === "idle"
                ? "Seated and waiting"
                : phase === "verdict"
                  ? "Tap a juror to hear them out"
                  : "Do not disturb"}
            </p>
          )}
        </div>
      </div>

      <div className="ct-well relative z-10">
        {wellControls && <div className="mb-2.5 px-1 text-center">{wellControls}</div>}
        {children}
      </div>
    </section>
  );
}
