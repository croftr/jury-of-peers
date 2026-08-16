import { NextResponse } from "next/server";

/**
 * A ceiling on how fast this app can be made to spend money.
 *
 * The login door is already guarded against guessing (see `auth.ts`), but the
 * expensive routes were not guarded against anything: one signed-in tab in a
 * loop is twelve model calls a go, and nothing stopped it going. Everyone who
 * gets in is equally trusted here, so this is not about telling users apart —
 * it is a brake on the bill.
 *
 * In memory, and therefore per-instance and reset by a restart. That is the
 * right trade for a personal tool: it makes a runaway loop impossible without
 * introducing a store to depend on. On more than one instance the effective
 * ceiling is this figure times the instance count, which is still a ceiling.
 */

interface Window {
  /** When this window opened. */
  from: number;
  count: number;
}

const buckets = new Map<string, Window>();

/** Swept opportunistically, so an app left running does not accumulate keys. */
const MAX_KEYS = 5000;

export interface Limit {
  /** Names the bucket, so uploads and model calls are counted separately. */
  name: string;
  /** How many requests are allowed in a window. */
  max: number;
  windowMs: number;
}

/**
 * Model calls: a full twelve-juror round is 12, and a case heard twice is 24.
 * Ninety in five minutes leaves room for a few cases and some follow-up
 * questions, and stops a loop dead.
 */
export const MODEL_CALLS: Limit = { name: "model", max: 90, windowMs: 5 * 60_000 };

/** Uploads are cheap but not free — they parse PDFs in the request. */
export const UPLOADS: Limit = { name: "upload", max: 40, windowMs: 5 * 60_000 };

export interface Verdict {
  ok: boolean;
  /** Seconds until the window rolls over, for a Retry-After header. */
  retryAfter: number;
}

/**
 * Count one request against a bucket.
 *
 * A fixed window rather than a sliding one: the failure mode is allowing up to
 * twice the limit across a boundary, which for a brake on spending is fine, and
 * it costs one small object per caller instead of a list of timestamps.
 */
export function take(key: string, limit: Limit): Verdict {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now - bucket.from >= limit.windowMs) {
    buckets.set(key, { from: now, count: 1 });
    sweep(now);
    return { ok: true, retryAfter: 0 };
  }

  bucket.count += 1;
  if (bucket.count > limit.max) {
    return { ok: false, retryAfter: Math.ceil((bucket.from + limit.windowMs - now) / 1000) };
  }
  return { ok: true, retryAfter: 0 };
}

function sweep(now: number) {
  if (buckets.size <= MAX_KEYS) return;
  for (const [key, bucket] of buckets) {
    // A day is longer than any window here, so anything this old is finished.
    if (now - bucket.from > 24 * 60 * 60_000) buckets.delete(key);
  }
}

/**
 * Who to count this against.
 *
 * There are no accounts, so the caller is identified by address — the first
 * entry in `x-forwarded-for`, which is the client as the closest proxy saw it.
 * Spoofable if the app is exposed without a proxy in front, which is why the
 * limit is a brake and not a security control: the door is the password.
 */
function callerOf(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || req.headers.get("x-real-ip")?.trim() || "local";
}

/**
 * The refusal a limited route should return, or null to carry on.
 *
 * Written as a guard clause so each route reads as one line at the top: this is
 * a brake, and a brake that is easy to forget to fit is not a brake.
 */
export function limited(req: Request, limit: Limit): NextResponse | null {
  const { ok, retryAfter } = take(`${limit.name}:${callerOf(req)}`, limit);
  if (ok) return null;
  return NextResponse.json(
    {
      error: `The court is being asked for too much at once. Try again in ${retryAfter} second${
        retryAfter === 1 ? "" : "s"
      }.`,
    },
    { status: 429, headers: { "Retry-After": String(retryAfter) } },
  );
}
