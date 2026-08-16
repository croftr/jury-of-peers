import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { tally as computeTally } from "./deliberate";
import { MAX_RECORD_BYTES } from "./estimate";
import type { ArchivedCase, CaseSummary, Juror, JurorFailure, JurorVerdict } from "./types";

/**
 * The case archive, kept in a private S3 bucket.
 *
 * S3 has no query, so each case is written twice: the full record under
 * `cases/`, and a one-line summary under `summaries/`. The list page reads only
 * the summaries — a single LIST plus a fan-out of small GETs — and the full
 * record is fetched only when a case is opened. The alternative, one shared
 * index object, would lose records whenever two cases finished at once.
 *
 * Keys are prefixed with a sortable timestamp, so S3's lexicographic LIST comes
 * back in chronological order and nothing has to be sorted after the fact.
 */

const BUCKET = process.env.CASES_BUCKET?.trim();
const REGION = process.env.CASES_BUCKET_REGION?.trim() || process.env.AWS_REGION?.trim();
/** Points the archive at an S3-compatible store instead of AWS. Unset for S3 proper. */
const ENDPOINT = process.env.CASES_BUCKET_ENDPOINT?.trim();

/** The most cases one request will fetch, however many are asked for. */
const LIST_LIMIT = 250;

/** A screenful. The list pages from here rather than fetching the archive. */
const DEFAULT_PAGE = 25;

/*
 * The record ceiling and the evidence limit derived from it live in `estimate.ts`
 * — generous for evidence, mean to anyone pasting a novel — so the case form can
 * warn about the limit without importing the S3 client to find out what it is.
 */

let client: S3Client | null = null;

/**
 * Whether the archive is wired up. With no bucket configured the app behaves
 * exactly as it did before: cases are decided, just not remembered.
 */
export function archiveEnabled(): boolean {
  return Boolean(BUCKET);
}

function s3(): S3Client {
  if (!BUCKET) throw new Error("CASES_BUCKET is not set.");
  // Credentials come from the default chain, so the same code works with keys in
  // .env.local locally and an instance role in deployment.
  client ??= new S3Client({
    ...(REGION ? { region: REGION } : {}),
    // Path-style addressing, since a local or third-party store has no
    // per-bucket subdomain to resolve.
    ...(ENDPOINT ? { endpoint: ENDPOINT, forcePathStyle: true } : {}),
  });
  return client;
}

const caseKey = (id: string) => `cases/${id}.json`;
const summaryKey = (id: string) => `summaries/${id}.json`;

/**
 * Ids are `<sortable timestamp>-<random>`: ordered by when the verdict landed,
 * with enough entropy that two cases finishing in the same millisecond do not
 * collide. Also the only shape `parseId` accepts, so an id from a URL can never
 * reach outside the bucket prefix.
 */
function newId(at: Date): string {
  const stamp = at.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const salt = Math.random().toString(36).slice(2, 8);
  return `${stamp}-${salt}`;
}

const ID_PATTERN = /^\d{8}T\d{6}Z-[a-z0-9]{1,12}$/;

export function isValidId(id: string): boolean {
  return ID_PATTERN.test(id);
}

/** The list view of a case, derived from the record so the two cannot drift. */
export function summarize(record: ArchivedCase): CaseSummary {
  const { tally, caseFile, firstRound } = record;
  const runnerUp = tally.counts[tally.majority === 0 ? 1 : 0];

  // How many jurors actually changed their finding between the two askings.
  // Counted here rather than stored, so it cannot disagree with the record.
  const before = new Map(firstRound?.map((v) => [v.jurorId, v.choice]));
  const moved = firstRound
    ? record.verdicts.filter((v) => before.has(v.jurorId) && before.get(v.jurorId) !== v.choice)
        .length
    : undefined;

  return {
    id: record.id,
    savedAt: record.savedAt,
    title: caseFile.title.trim() || "An untitled matter",
    jurorCount: record.verdicts.length,
    benchSize: record.jurors.length,
    verdict: tally.hung ? "Hung jury" : caseFile.options[tally.majority],
    split: `${tally.counts[tally.majority]}–${runnerUp}`,
    hung: tally.hung,
    majority: tally.majority,
    ...(firstRound ? { rounds: 2 as const, moved } : { rounds: 1 as const }),
    // Enough of each juror's finding to build their record from summaries alone.
    // Confidence is rounded: two decimal places is more precision than anyone
    // reads, and the summaries are fetched by the hundred.
    findings: record.verdicts.map((v) => ({
      jurorId: v.jurorId,
      choice: v.choice,
      confidence: Math.round(v.confidence * 100) / 100,
      ...(before.has(v.jurorId) && before.get(v.jurorId) !== v.choice ? { moved: true } : {}),
    })),
  };
}

/**
 * Commit a finished case. The full record goes down first: a summary with no
 * case behind it would be a dead row in the list, whereas a case with no summary
 * is merely invisible.
 */
export async function saveCase(
  input: {
    caseFile: ArchivedCase["caseFile"];
    jurors: Juror[];
    instructions: Record<number, string>;
    verdicts: JurorVerdict[];
    firstRound?: JurorVerdict[];
    failures: JurorFailure[];
    /** The case this was a retrial of, when it was one. */
    retrialOf?: string;
  },
  /**
   * An existing record to write over, used when the room goes back out: the
   * second round supersedes the first rather than filing the same case twice.
   * Both objects are overwritten in place, so it is safe to repeat.
   */
  existingId?: string,
): Promise<CaseSummary> {
  const at = new Date();
  const record: ArchivedCase = {
    // The id carries the time the case was first filed, so a superseded case
    // keeps its place in the archive's order rather than jumping to the top.
    id: existingId && isValidId(existingId) ? existingId : newId(at),
    savedAt: at.toISOString(),
    caseFile: input.caseFile,
    jurors: input.jurors,
    instructions: input.instructions,
    verdicts: input.verdicts,
    ...(input.firstRound?.length ? { firstRound: input.firstRound } : {}),
    ...(input.retrialOf && isValidId(input.retrialOf) ? { retrialOf: input.retrialOf } : {}),
    failures: input.failures,
    // Recomputed rather than trusted, so the stored count always matches the
    // stored verdicts however the client got there.
    tally: computeTally(input.verdicts),
  };

  const body = JSON.stringify(record);
  if (Buffer.byteLength(body) > MAX_RECORD_BYTES) {
    throw new Error("This case is too large to archive.");
  }

  const summary = summarize(record);

  await put(caseKey(record.id), body);
  await put(summaryKey(record.id), JSON.stringify(summary));

  return summary;
}

async function put(Key: string, body: string) {
  await s3().send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key,
      Body: body,
      ContentType: "application/json",
    }),
  );
}

async function getJson<T>(Key: string): Promise<T | null> {
  try {
    const res = await s3().send(new GetObjectCommand({ Bucket: BUCKET, Key }));
    const text = await res.Body?.transformToString();
    return text ? (JSON.parse(text) as T) : null;
  } catch (err) {
    // A missing object is an ordinary answer here, not a failure.
    if (err instanceof NoSuchKey || (err as { name?: string })?.name === "NoSuchKey") return null;
    throw err;
  }
}

/**
 * Every summary key in the bucket, newest first.
 *
 * LIST is the cheap half of reading the archive — one request per thousand keys,
 * and no object bodies — so this always walks the lot. Keys carry a sortable
 * timestamp, so lexicographic order is chronological order and the newest cases
 * are simply the tail.
 */
async function summaryKeys(): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;

  do {
    const page = await s3().send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: "summaries/",
        ContinuationToken: token,
      }),
    );
    for (const object of page.Contents ?? []) {
      if (object.Key?.endsWith(".json")) keys.push(object.Key);
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);

  return keys.reverse();
}

/**
 * Fetch summaries a few at a time.
 *
 * The GETs are the expensive half, and firing two hundred at once is how a
 * bucket starts refusing them. Twelve in flight keeps the page quick without
 * making the archive angry.
 */
async function fetchSummaries(keys: string[]): Promise<CaseSummary[]> {
  const CONCURRENCY = 12;
  const out: (CaseSummary | null)[] = new Array(keys.length).fill(null);
  let next = 0;

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, keys.length) }, async () => {
      for (let i = next++; i < keys.length; i = next++) {
        out[i] = await getJson<CaseSummary>(keys[i]);
      }
    }),
  );

  // A summary that has gone missing shouldn't take the whole page down with it.
  return out.filter((s): s is CaseSummary => Boolean(s?.id));
}

export interface CasePage {
  cases: CaseSummary[];
  /** Pass back as `before` for the next page. Absent when there are no more. */
  nextCursor?: string;
}

/**
 * One page of archived cases, newest first.
 *
 * Paged because the list only ever shows a screenful: fetching two hundred and
 * fifty summary objects to render twenty-five of them was the single most
 * expensive thing this app did, and it did it on every visit.
 */
export async function listCases(options: { limit?: number; before?: string } = {}): Promise<CasePage> {
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_PAGE, 1), LIST_LIMIT);
  const keys = await summaryKeys();

  // The cursor is the last id of the previous page — everything up to and
  // including it has already been seen. An id that is no longer there (struck
  // between one page and the next) simply starts from the top again, which is
  // the least surprising thing it could do.
  let start = 0;
  if (options.before) {
    const at = keys.indexOf(summaryKey(options.before));
    if (at !== -1) start = at + 1;
  }

  const window = keys.slice(start, start + limit);
  const cases = await fetchSummaries(window);
  const more = start + limit < keys.length;

  return {
    cases,
    ...(more && cases.length ? { nextCursor: cases[cases.length - 1].id } : {}),
  };
}

/**
 * Every summary in the archive, for the juror record.
 *
 * Deliberately the expensive read — the record is a statement about the whole
 * archive, so it has to read the whole archive. It is one page the user asks
 * for, not one they land on.
 */
export async function listAllSummaries(): Promise<CaseSummary[]> {
  return fetchSummaries(await summaryKeys());
}

/**
 * Strike cases from the record, summary first.
 *
 * Both objects go in one batch call, and S3 treats deleting an absent key as a
 * success — so a half-finished delete can be retried without special handling.
 * Returns the ids that could not be removed rather than throwing, so one bad
 * case doesn't hide the fact that the rest went.
 */
export async function deleteCases(ids: string[]): Promise<{ deleted: string[]; failed: string[] }> {
  const wanted = [...new Set(ids.filter(isValidId))];
  const deleted: string[] = [];
  const failed = ids.filter((id) => !isValidId(id));

  // One request handles 1000 keys, and a case is two of them.
  const PER_BATCH = 500;

  for (let i = 0; i < wanted.length; i += PER_BATCH) {
    const batch = wanted.slice(i, i + PER_BATCH);
    const res = await s3().send(
      new DeleteObjectsCommand({
        Bucket: BUCKET,
        Delete: {
          Objects: batch.flatMap((id) => [{ Key: summaryKey(id) }, { Key: caseKey(id) }]),
          Quiet: true,
        },
      }),
    );

    // S3 reports a refused key inside a 200, so without this a permission
    // problem would surface as a silent "could not be struck" and nothing else.
    for (const e of res.Errors ?? []) {
      console.error(`Refused to delete ${e.Key}: ${e.Code} — ${e.Message}`);
    }

    // Quiet mode reports only what went wrong. A case counts as struck only if
    // neither of its two objects came back in the error list.
    const broken = new Set(
      (res.Errors ?? []).map((e) => e.Key?.replace(/^(cases|summaries)\//, "").replace(/\.json$/, "")),
    );
    for (const id of batch) (broken.has(id) ? failed : deleted).push(id);
  }

  return { deleted, failed };
}

/** One case in full, or null if there is no such case. */
export async function loadCase(id: string): Promise<ArchivedCase | null> {
  if (!isValidId(id)) return null;
  return getJson<ArchivedCase>(caseKey(id));
}
