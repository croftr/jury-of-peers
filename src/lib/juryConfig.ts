"use client";

import { useCallback, useSyncExternalStore } from "react";
import { JURORS } from "./jurors";

/**
 * Who is empanelled, and what standing instruction each juror carries.
 *
 * Lives in the browser: this is a personal tool, the config is small, and
 * keeping it client-side means no account, no database, and no round trip
 * before the jury box can render. The server never stores it — the client
 * sends each juror's instruction along with the case.
 */
export interface JuryConfig {
  /** Juror ids currently seated. At least one, always. */
  seated: number[];
  /** Per-juror standing instruction, keyed by juror id. */
  instructions: Record<number, string>;
}

const STORAGE_KEY = "jury-of-peers/config/v1";

/** Long enough for real guidance, short enough not to swamp the case itself. */
export const MAX_INSTRUCTION = 1200;

export const DEFAULT_CONFIG: JuryConfig = {
  seated: JURORS.map((j) => j.id),
  instructions: {},
};

/** Drop unknown ids, restore seat order, and never allow an empty jury. */
export function sanitize(config: Partial<JuryConfig> | null | undefined): JuryConfig {
  const valid = new Set(JURORS.map((j) => j.id));

  const seated = JURORS.map((j) => j.id).filter((id) =>
    Array.isArray(config?.seated) ? config!.seated.includes(id) : true,
  );

  const instructions: Record<number, string> = {};
  for (const [key, value] of Object.entries(config?.instructions ?? {})) {
    const id = Number(key);
    if (!valid.has(id) || typeof value !== "string") continue;
    // Store what was typed — trimming here would eat the space the moment you
    // press it, making multi-word instructions impossible to type. The trim
    // happens where it matters: emptiness below, and again on the server.
    const kept = value.slice(0, MAX_INSTRUCTION);
    if (kept.trim()) instructions[id] = kept;
  }

  // A jury of nobody cannot return a verdict — fall back to the full bench.
  return { seated: seated.length ? seated : [...DEFAULT_CONFIG.seated], instructions };
}

function read(): JuryConfig {
  if (typeof window === "undefined") return DEFAULT_CONFIG;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? sanitize(JSON.parse(raw) as Partial<JuryConfig>) : DEFAULT_CONFIG;
  } catch {
    return DEFAULT_CONFIG;
  }
}

/*
 * localStorage is an external store, so treat it as one. A module-level cache
 * keeps snapshots referentially stable (useSyncExternalStore re-renders on any
 * identity change), and every consumer — the court, the jury page, a juror's
 * page — reads the same one.
 */
let cache: JuryConfig = DEFAULT_CONFIG;
let loaded = false;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function getSnapshot(): JuryConfig {
  if (!loaded) {
    cache = read();
    loaded = true;
  }
  return cache;
}

/** Hydration renders against the default, so server and client markup agree. */
function getServerSnapshot(): JuryConfig {
  return DEFAULT_CONFIG;
}

function onStorage(event: StorageEvent) {
  if (event.key !== STORAGE_KEY) return;
  cache = read();
  notify();
}

function subscribe(listener: () => void) {
  if (!listeners.size) window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    // Keep two open tabs (or the jury page and the court) in step.
    if (!listeners.size) window.removeEventListener("storage", onStorage);
  };
}

/** Shared jury configuration, backed by localStorage. */
export function useJuryConfig() {
  const config = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  /*
   * Always derive from the store's current value, never from the `config` this
   * render closed over. Two toggles in the same tick both read the same stale
   * render value, and the second silently undoes the first.
   */
  const mutate = useCallback((change: (current: JuryConfig) => JuryConfig) => {
    cache = sanitize(change(getSnapshot()));
    loaded = true;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
    } catch {
      // Private browsing or a full quota — the config still applies this session.
    }
    notify();
  }, []);

  const update = useCallback((next: JuryConfig) => mutate(() => next), [mutate]);

  const toggleSeat = useCallback(
    (jurorId: number) =>
      mutate((current) => {
        const seated = current.seated.includes(jurorId)
          ? current.seated.filter((id) => id !== jurorId)
          : [...current.seated, jurorId];
        // Refuse to empty the box; the caller disables the control too.
        return seated.length ? { ...current, seated } : current;
      }),
    [mutate],
  );

  const setInstruction = useCallback(
    (jurorId: number, text: string) =>
      mutate((current) => {
        const instructions = { ...current.instructions };
        const kept = text.slice(0, MAX_INSTRUCTION);
        if (kept.trim()) instructions[jurorId] = kept;
        else delete instructions[jurorId];
        return { ...current, instructions };
      }),
    [mutate],
  );

  const reset = useCallback(() => mutate(() => DEFAULT_CONFIG), [mutate]);

  return { config, update, toggleSeat, setInstruction, reset };
}

/** The seated jurors, in seat order. */
export function seatedJurors(config: JuryConfig) {
  return JURORS.filter((j) => config.seated.includes(j.id));
}
