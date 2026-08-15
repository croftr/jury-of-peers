import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { tally as computeTally } from "./deliberate";
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

/** Beyond this the list page stops being a list. Older cases stay retrievable by id. */
const LIST_LIMIT = 250;

/** A whole case in one object — generous for evidence, mean to anyone pasting a novel. */
export const MAX_RECORD_BYTES = 1_000_000;

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
  const { tally, caseFile } = record;
  const runnerUp = tally.counts[tally.majority === 0 ? 1 : 0];

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
  };
}

/**
 * Commit a finished case. The full record goes down first: a summary with no
 * case behind it would be a dead row in the list, whereas a case with no summary
 * is merely invisible.
 */
export async function saveCase(input: {
  caseFile: ArchivedCase["caseFile"];
  jurors: Juror[];
  instructions: Record<number, string>;
  verdicts: JurorVerdict[];
  failures: JurorFailure[];
}): Promise<CaseSummary> {
  const at = new Date();
  const record: ArchivedCase = {
    id: newId(at),
    savedAt: at.toISOString(),
    caseFile: input.caseFile,
    jurors: input.jurors,
    instructions: input.instructions,
    verdicts: input.verdicts,
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

/** Every archived case, newest first. */
export async function listCases(): Promise<CaseSummary[]> {
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

  // LIST returns ascending; the newest cases are the tail.
  const newest = keys.slice(-LIST_LIMIT).reverse();
  const summaries = await Promise.all(newest.map((key) => getJson<CaseSummary>(key)));

  // A summary that has gone missing shouldn't take the whole page down with it.
  return summaries.filter((s): s is CaseSummary => Boolean(s?.id));
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
