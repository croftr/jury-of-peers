"use client";

import JurorAvatar from "./JurorAvatar";
import type { Juror, JurorVerdict } from "@/lib/types";

export type Phase = "idle" | "deliberating" | "verdict";

export default function JurorSeat({
  juror,
  verdict,
  failure,
  phase,
  options,
  index,
  onSelect,
}: {
  juror: Juror;
  verdict?: JurorVerdict;
  failure?: string;
  phase: Phase;
  options: [string, string];
  index: number;
  onSelect: () => void;
}) {
  const failed = Boolean(failure) && !verdict;
  const deliberating = phase === "deliberating" && !verdict && !failed;
  const decided = Boolean(verdict);
  const tone = verdict
    ? verdict.choice === 0
      ? "var(--for)"
      : "var(--against)"
    : failed
      ? "var(--muted)"
      : "var(--brass)";

  const R = 44;
  const circumference = 2 * Math.PI * R;

  return (
    <button
      type="button"
      onClick={onSelect}
      className="group relative flex flex-col items-center gap-2 outline-none
                 focus-visible:ring-2 focus-visible:ring-brass/60 rounded-lg"
      style={{ animationDelay: `${index * 70}ms` }}
      aria-label={`Seat ${juror.seat}, ${juror.alias}`}
      title={
        decided
          ? `${juror.alias} — read their reasoning`
          : failed
            ? `${juror.alias} — could not be reached`
            : juror.alias
      }
    >
      <div
        className={`relative size-[clamp(40px,7.6vw,84px)] ${deliberating ? "a-breathe" : ""}`}
        style={{ animationDelay: `${(index % 6) * 260}ms`, color: tone }}
      >
        {/* hover halo — the seats are clickable, so say so on approach */}
        <span
          className="pointer-events-none absolute -inset-1 rounded-full opacity-0
                     group-hover:opacity-100 transition-opacity duration-300"
          style={{ boxShadow: `0 0 22px -4px ${tone}, inset 0 0 0 1px ${tone}` }}
        />
        {/* pulse rings while this juror is still out */}
        {deliberating && (
          <>
            <span className="thinking-ring" style={{ animationDelay: `${index * 190}ms` }} />
            <span
              className="thinking-ring"
              style={{ animationDelay: `${index * 190 + 900}ms`, opacity: 0.5 }}
            />
          </>
        )}

        {/* confidence arc, drawn once the verdict lands */}
        <svg viewBox="0 0 100 100" className="absolute -inset-1 -rotate-90">
          <circle
            cx="50"
            cy="50"
            r={R}
            fill="none"
            stroke="rgba(255,255,255,0.08)"
            strokeWidth="2.5"
          />
          {decided && (
            <circle
              cx="50"
              cy="50"
              r={R}
              fill="none"
              stroke={tone}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - (verdict?.confidence ?? 0))}
              style={{ transition: "stroke-dashoffset 1.1s cubic-bezier(0.16,1,0.3,1)" }}
            />
          )}
        </svg>

        <div
          className="absolute inset-[3px] rounded-full overflow-hidden transition-all duration-500"
          style={{
            boxShadow: decided
              ? `0 0 26px -6px ${tone}, inset 0 0 0 1.5px ${tone}`
              : deliberating
                ? "0 0 22px -8px var(--brass), inset 0 0 0 1px rgba(201,162,39,0.45)"
                : "inset 0 0 0 1px rgba(255,255,255,0.12)",
          }}
        >
          <JurorAvatar
            spec={juror.avatar}
            mood={decided ? "decided" : deliberating ? "thinking" : "idle"}
            className="size-full transition-transform duration-500 group-hover:scale-105"
          />
          {!decided && phase !== "idle" && (
            <span className="absolute inset-0 bg-black/45 backdrop-grayscale" />
          )}
        </div>

        {/* seat numeral */}
        <span
          className="mono absolute -bottom-1 left-1/2 -translate-x-1/2 px-1.5 py-px rounded
                     text-[9px] tracking-[0.14em] bg-ink border border-white/10 text-muted"
        >
          {juror.seat}
        </span>
      </div>

      <div className="h-9 w-[clamp(44px,8vw,92px)] flex flex-col items-center justify-start">
        {failed ? (
          <span className="mono text-[9px] tracking-[0.12em] uppercase text-muted/70 pt-1 text-center leading-tight a-rise">
            Unreachable
          </span>
        ) : deliberating ? (
          <span className="flex gap-1 pt-2" aria-label="deliberating">
            {[0, 1, 2].map((d) => (
              <span
                key={d}
                className="size-1 rounded-full bg-brass"
                style={{
                  animation: `think-dot 1.4s ease-in-out ${d * 0.18 + index * 0.05}s infinite`,
                }}
              />
            ))}
          </span>
        ) : decided ? (
          <span
            className="mono text-[9px] tracking-[0.12em] uppercase text-center leading-tight a-rise px-1"
            style={{ color: tone }}
          >
            {options[verdict!.choice]}
            <span className="block text-muted/70 mt-0.5">
              {Math.round(verdict!.confidence * 100)}% sure
            </span>
          </span>
        ) : (
          <span className="mono text-[9px] tracking-[0.12em] uppercase text-muted/60 pt-1 text-center leading-tight">
            {juror.alias}
          </span>
        )}
      </div>
    </button>
  );
}
