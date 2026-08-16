"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import JurorAvatar from "./JurorAvatar";
import { slugFor } from "@/lib/jurors";
import { modelFor } from "@/lib/models";
import type { CaseFile, Juror, JurorExplanation, JurorVerdict } from "@/lib/types";

export default function JurorDossier({
  juror,
  verdict,
  firstVerdict,
  heldOver,
  failure,
  caseFile,
  instruction,
  explanation,
  asking,
  askError,
  onAsk,
  onClose,
}: {
  juror: Juror;
  verdict?: JurorVerdict;
  /** What this juror said before hearing the room, on a case heard twice. */
  firstVerdict?: JurorVerdict;
  /** Why they could not be reached the second time, if they could not be. */
  heldOver?: string;
  failure?: string;
  caseFile: CaseFile;
  /** The standing instruction this juror sat under for *this* case. */
  instruction?: string;
  explanation?: JurorExplanation;
  asking?: boolean;
  askError?: string;
  /** Omitted for an archived case, where the jury has long since gone home. */
  onAsk?: (jurorId: number, question: string) => void;
  onClose: () => void;
}) {
  const [question, setQuestion] = useState("");
  const model = modelFor(juror.id);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const tone = verdict ? (verdict.choice === 0 ? "var(--for)" : "var(--against)") : "var(--brass)";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="panel rounded-2xl w-full max-w-lg overflow-hidden a-rise"
        style={{ boxShadow: `0 40px 120px -50px ${tone}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-px" style={{ background: `linear-gradient(90deg,transparent,${tone},transparent)` }} />

        <div className="p-6 sm:p-8">
          <div className="flex items-start gap-5">
            <div
              className="size-20 shrink-0 rounded-full overflow-hidden"
              style={{ boxShadow: `inset 0 0 0 1.5px ${tone}` }}
            >
              <JurorAvatar
                spec={juror.avatar}
                mood={verdict ? "decided" : "idle"}
                className="size-full"
              />
            </div>
            <div className="min-w-0">
              <p className="mono text-[10px] tracking-[0.28em] uppercase text-muted">
                Seat {juror.seat} · {juror.archetype}
              </p>
              <h3 className="display text-3xl mt-0.5">{juror.alias}</h3>
              <p className="text-sm text-muted mt-2 leading-relaxed">{juror.disposition}</p>
              {model && (
                <>
                  <p className="mono text-[10px] tracking-[0.14em] uppercase text-muted/70 mt-3">
                    Reasoned by{" "}
                    <span className="text-bone/80">{model.label}</span> · {model.lab}
                    {verdict?.source === "simulated" && (
                      <span className="text-brass"> · simulated, model not called</span>
                    )}
                  </p>
                  {verdict?.source === "live" && verdict.model && (
                    <p className="mono text-[9px] tracking-[0.1em] text-muted/50 mt-1 break-all">
                      served: {verdict.model}
                      {verdict.provider && ` · via ${verdict.provider}`}
                    </p>
                  )}
                </>
              )}
            </div>
          </div>

          {instruction && (
            <div className="mt-5 rounded-lg border border-brass/25 bg-brass/5 px-4 py-3">
              <p className="mono text-[9px] tracking-[0.2em] uppercase text-brass mb-1.5">
                Under standing instruction
              </p>
              <p className="text-xs text-bone/80 leading-relaxed italic">“{instruction}”</p>
            </div>
          )}

          <div className="my-6 rule" />

          {verdict ? (
            <>
              <div className="flex items-baseline justify-between gap-4">
                <p className="mono text-[10px] tracking-[0.24em] uppercase text-muted">
                  Finding
                </p>
                <p className="mono text-[10px] tracking-[0.16em] uppercase text-muted tabular-nums">
                  {(verdict.deliberationMs / 1000).toFixed(1)}s deliberating
                </p>
              </div>
              <p className="display text-4xl mt-1 uppercase" style={{ color: tone }}>
                {caseFile.options[verdict.choice]}
              </p>

              <div className="mt-4 flex items-center gap-3">
                <div className="h-1 flex-1 rounded-full bg-white/8 overflow-hidden">
                  <div
                    className="h-full"
                    style={{
                      width: `${verdict.confidence * 100}%`,
                      background: tone,
                      animation: "bar-grow 1s cubic-bezier(0.16,1,0.3,1) both",
                    }}
                  />
                </div>
                <span className="mono text-[10px] text-muted tabular-nums">
                  {Math.round(verdict.confidence * 100)}% confidence
                </span>
              </div>

              <p className="mt-6 mono text-[10px] tracking-[0.24em] uppercase text-muted">
                Why they decided
              </p>
              <blockquote className="mt-2 pl-4 border-l text-[15px] leading-relaxed text-bone/90 display"
                style={{ borderColor: tone }}
              >
                “{verdict.rationale}”
              </blockquote>

              <p className="mt-4 mono text-[10px] tracking-[0.16em] uppercase text-muted">
                Sticking point · {verdict.pivot}
              </p>

              {/* Where they stood before the room was put to them. Shown whether
                  or not they moved — holding under argument is a result too. */}
              {firstVerdict && (
                <div className="mt-5 rounded-lg border border-white/8 bg-black/25 px-4 py-3">
                  <p className="mono text-[9px] tracking-[0.2em] uppercase text-muted/70">
                    {heldOver
                      ? "Not reached the second time"
                      : firstVerdict.choice !== verdict.choice
                        ? "Moved after hearing the room"
                        : "Held after hearing the room"}
                  </p>

                  {heldOver ? (
                    <p className="text-xs text-bone/70 mt-2 leading-relaxed">
                      {heldOver} The finding above is the one {juror.alias} gave the first time,
                      and it still counts.
                    </p>
                  ) : (
                    <>
                      <p className="mt-1.5 text-sm text-bone/80">
                        <span className="mono text-[11px] tracking-[0.1em] uppercase">
                          <span
                            style={{
                              color:
                                firstVerdict.choice === 0 ? "var(--for)" : "var(--against)",
                            }}
                          >
                            {caseFile.options[firstVerdict.choice]}
                          </span>
                          <span className="text-muted/60">
                            {" "}
                            at {Math.round(firstVerdict.confidence * 100)}%
                          </span>
                          <span className="text-muted/40"> → </span>
                          <span style={{ color: tone }}>{caseFile.options[verdict.choice]}</span>
                          <span className="text-muted/60">
                            {" "}
                            at {Math.round(verdict.confidence * 100)}%
                          </span>
                        </span>
                      </p>
                      <p className="mt-2 text-xs leading-relaxed text-muted italic">
                        First time round: “{firstVerdict.rationale}”
                      </p>
                    </>
                  )}
                </div>
              )}

              {verdict.usage && (
                <p className="mt-2 mono text-[10px] tracking-[0.12em] uppercase text-muted/60 tabular-nums">
                  {verdict.usage.promptTokens.toLocaleString()} in ·{" "}
                  {verdict.usage.completionTokens.toLocaleString()} out
                  {verdict.usage.costUsd !== undefined &&
                    ` · $${verdict.usage.costUsd.toFixed(5)}`}
                </p>
              )}

              <div className="my-6 rule" />

              <p className="mono text-[10px] tracking-[0.24em] uppercase text-muted">
                {onAsk ? "Put it to them" : "On the record"}
              </p>

              {explanation && (
                <div className="mt-3 rounded-lg border border-white/8 bg-black/25 px-4 py-3">
                  <p className="mono text-[9px] tracking-[0.14em] uppercase text-muted/70 mb-2">
                    Asked · {explanation.question}
                  </p>
                  {explanation.text.split(/\n{2,}/).map((para, i) => (
                    <p key={i} className="text-sm leading-relaxed text-bone/90 mb-2 last:mb-0">
                      {para}
                    </p>
                  ))}
                  {explanation.usage && (
                    <p className="mt-3 mono text-[9px] tracking-[0.12em] uppercase text-muted/50 tabular-nums">
                      {explanation.usage.promptTokens.toLocaleString()} in ·{" "}
                      {explanation.usage.completionTokens.toLocaleString()} out
                      {explanation.usage.costUsd !== undefined &&
                        ` · $${explanation.usage.costUsd.toFixed(5)}`}
                    </p>
                  )}
                </div>
              )}

              {askError && <p className="mt-3 text-sm text-for">{askError}</p>}

              {onAsk ? (
                <>
                  <div className="mt-3 flex gap-2">
                    <input
                      value={question}
                      onChange={(e) => setQuestion(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !asking) onAsk(juror.id, question);
                      }}
                      maxLength={500}
                      disabled={asking}
                      placeholder={
                        explanation ? "Ask something else…" : "Ask your own question, or just press Explain"
                      }
                      className="flex-1 min-w-0 bg-black/30 border border-white/8 rounded-lg px-3 py-2.5 text-sm
                                 outline-none focus:border-brass/50 transition-colors placeholder:text-white/20
                                 disabled:opacity-50"
                    />
                    <button
                      onClick={() => onAsk(juror.id, question)}
                      disabled={asking}
                      className="mono text-[10px] tracking-[0.16em] uppercase px-4 rounded-lg border border-brass/45
                                 text-brass-lit hover:bg-brass/10 transition-colors shrink-0
                                 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {asking ? "Asking…" : question.trim() ? "Ask" : "Explain"}
                    </button>
                  </div>
                  <p className="mt-2 mono text-[9px] tracking-[0.12em] uppercase text-muted/50">
                    Puts the question to {juror.alias} again — costs a fraction of a cent
                  </p>
                </>
              ) : (
                <p className="mt-3 text-sm text-muted leading-relaxed">
                  This case has been decided and filed. What {juror.alias} said stands
                  as it was said — the jury cannot be recalled to answer for it.
                </p>
              )}
            </>
          ) : failure ? (
            <>
              <p className="mono text-[10px] tracking-[0.24em] uppercase text-for">
                Seat empty
              </p>
              <p className="text-sm text-bone/80 mt-2 leading-relaxed">{failure}</p>
              <p className="text-xs text-muted mt-3">
                This juror was excluded from the count — any verdict stands on the
                jurors who did answer.
              </p>
            </>
          ) : (
            <p className="text-sm text-muted italic">
              This juror has not returned a finding yet.
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 border-t border-white/8">
          <Link
            href={`/jury/${slugFor(juror)}`}
            className="py-3.5 text-center border-r border-white/8 mono text-[10px] tracking-[0.2em] uppercase
                       text-muted hover:text-brass-lit hover:bg-white/5 transition-colors"
          >
            Full profile →
          </Link>
          <button
            onClick={onClose}
            className="py-3.5 mono text-[10px] tracking-[0.26em] uppercase
                       text-muted hover:text-bone hover:bg-white/5 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
