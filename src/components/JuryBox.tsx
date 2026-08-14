"use client";

import JurorSeat, { type Phase } from "./JurorSeat";
import type { Juror, JurorVerdict } from "@/lib/types";

/**
 * Bend a flat row into an arc: the further from the row's centre, the further
 * the seat drops. Squaring the distance keeps the middle seats nearly level and
 * the outer ones noticeably lower, which reads as a curve rather than a wedge.
 */
function arcOffset(index: number, length: number): number {
  if (length < 2) return 0;
  const middle = (length - 1) / 2;
  const distance = Math.abs(index - middle) / middle;
  return Math.round(distance * distance * 26);
}

export default function JuryBox({
  jurors,
  verdicts,
  failures,
  phase,
  options,
  onSelect,
  children,
}: {
  jurors: Juror[];
  verdicts: Map<number, JurorVerdict>;
  failures: Map<number, string>;
  phase: Phase;
  options: [string, string];
  onSelect: (jurorId: number) => void;
  children?: React.ReactNode;
}) {
  // Split into two facing arcs. An odd bench puts the extra juror on the top row.
  const half = Math.ceil(jurors.length / 2);
  const rows = [jurors.slice(0, half), jurors.slice(half)];

  return (
    <section className="relative">
      {/* the well of the court */}
      <div
        className="absolute inset-x-4 top-[22%] bottom-[22%] rounded-[50%] pointer-events-none"
        style={{
          background:
            "radial-gradient(closest-side, rgba(201,162,39,0.10), rgba(201,162,39,0.02) 60%, transparent)",
        }}
      />

      <Row row={rows[0]} up offset={0} {...{ verdicts, failures, phase, options, onSelect }} />

      <div className="relative z-10 py-6 sm:py-8 flex justify-center">{children}</div>

      <Row
        row={rows[1]}
        up={false}
        offset={rows[0].length}
        {...{ verdicts, failures, phase, options, onSelect }}
      />
    </section>
  );
}

function Row({
  row,
  up,
  offset,
  verdicts,
  failures,
  phase,
  options,
  onSelect,
}: {
  row: Juror[];
  up: boolean;
  offset: number;
  verdicts: Map<number, JurorVerdict>;
  failures: Map<number, string>;
  phase: Phase;
  options: [string, string];
  onSelect: (jurorId: number) => void;
}) {
  if (!row.length) return null;

  return (
    <div className="relative flex justify-center gap-[clamp(2px,1.4vw,24px)]">
      {row.map((juror, i) => {
        const lift = arcOffset(i, row.length);
        return (
          <div
            key={juror.id}
            className="a-rise"
            style={{
              transform: `translateY(${up ? -lift : lift}px)`,
              animationDelay: `${(offset + i) * 55}ms`,
            }}
          >
            <JurorSeat
              juror={juror}
              verdict={verdicts.get(juror.id)}
              failure={failures.get(juror.id)}
              phase={phase}
              options={options}
              index={offset + i}
              onSelect={() => onSelect(juror.id)}
            />
          </div>
        );
      })}
    </div>
  );
}
