"use client";

import type { CaseFile } from "./types";

/**
 * Carrying an archived case back to the court.
 *
 * The evidence can be hundreds of kilobytes, so it does not go in the URL; and
 * a retrial is a one-shot handoff between two pages, so it does not belong in
 * `localStorage` beside the jury either. `sessionStorage`, read once and
 * cleared, is exactly the lifetime this has: press the button, arrive at the
 * court with the file open, and a reload afterwards is an ordinary new case
 * rather than a retrial that keeps re-proposing itself.
 */

const KEY = "jury-of-peers/retrial/v1";

export interface Retrial {
  caseFile: CaseFile;
  /** The archived case this is a retrial of. */
  priorId: string;
}

export function proposeRetrial(caseFile: CaseFile, priorId: string): boolean {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify({ caseFile, priorId }));
    return true;
  } catch {
    // Private browsing, or a case too large for the quota. The caller says so
    // rather than navigating to a court that will not know why it is there.
    return false;
  }
}

/**
 * Read the pending retrial without consuming it.
 *
 * Kept separate from `clearRetrial` so this stays pure: the court reads it as a
 * lazy state initialiser, which React is free to run more than once, and a read
 * that cleared as it went would lose the case on the second run. Forgetting it
 * is a write to an external store, and belongs in an effect.
 */
export function peekRetrial(): Retrial | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<Retrial>;
    const file = parsed.caseFile;
    if (
      typeof parsed.priorId !== "string" ||
      !file ||
      typeof file.evidence !== "string" ||
      !file.evidence.trim() ||
      !Array.isArray(file.options) ||
      file.options.length !== 2
    ) {
      return null;
    }

    return {
      priorId: parsed.priorId,
      caseFile: {
        title: typeof file.title === "string" ? file.title : "",
        evidence: file.evidence,
        options: [String(file.options[0]), String(file.options[1])],
      },
    };
  } catch {
    return null;
  }
}

/**
 * Forget the pending retrial, so a reload is an ordinary new case rather than a
 * retrial that keeps proposing itself.
 */
export function clearRetrial(): void {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to do: at worst the case is offered again on the next load.
  }
}
