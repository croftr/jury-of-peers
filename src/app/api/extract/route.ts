import { NextResponse } from "next/server";
import { UPLOADS, limited } from "@/lib/rateLimit";

// PDF.js and mammoth both want a real Node runtime, and both are lazily
// imported below so an upload of a plain .txt never pays for either.
export const runtime = "nodejs";

/** Comfortably under the archive's ceiling, and far past any sane case file. */
const MAX_BYTES = 20 * 1024 * 1024;
/** Extracted text is capped at the same size the archive will accept. */
const MAX_CHARS = 400_000;

/** Extensions we can read, by the tool that reads them. */
const PLAIN = [".txt", ".text", ".md", ".markdown", ".csv", ".tsv", ".json", ".log", ".rtf"];

export const ACCEPTED = [...PLAIN, ".pdf", ".docx"];

/**
 * RTF is plain text wrapped in control words. Stripping them is crude but it
 * beats handing the jury a page of `\pard\fs22` — and it is only reached for
 * files that were already going to be read as text.
 */
function stripRtf(raw: string): string {
  return raw
    .replace(/\\'([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\par[d]?\b/g, "\n")
    .replace(/\\tab\b/g, "\t")
    .replace(/\{\\\*[^{}]*\}/g, "")
    .replace(/\\[a-z]+-?\d*\s?/gi, "")
    .replace(/[{}]/g, "");
}

/** Collapse the ragged whitespace every extractor leaves behind. */
function tidy(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * POST — turn an uploaded document into the plain text a juror can read.
 *
 * The file is parsed and discarded in the same request; nothing is written to
 * disk. Only the extracted text goes back to the client, which then holds it in
 * the case file like anything that was typed in by hand.
 */
export async function POST(req: Request) {
  const brake = limited(req, UPLOADS);
  if (brake) return brake;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "That upload could not be read." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file was attached." }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "That file is empty." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `That file is too large. The limit is ${MAX_BYTES / 1024 / 1024}MB.` },
      { status: 413 },
    );
  }

  const name = file.name || "document";
  const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
  const bytes = new Uint8Array(await file.arrayBuffer());

  let text: string;
  try {
    if (ext === ".pdf") {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(bytes);
      const { text: pages } = await extractText(pdf, { mergePages: false });
      // Page breaks are kept: a juror reading an exhibit should be able to see
      // where one page ended and the next began.
      text = pages.join("\n\n");
    } else if (ext === ".docx") {
      const mammoth = (await import("mammoth")).default;
      const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
      text = value;
    } else if (ext === ".doc") {
      return NextResponse.json(
        { error: "Old .doc files can't be read. Save it as .docx or PDF and try again." },
        { status: 415 },
      );
    } else if (PLAIN.includes(ext) || file.type.startsWith("text/")) {
      const decoded = new TextDecoder("utf-8").decode(bytes);
      text = ext === ".rtf" ? stripRtf(decoded) : decoded;
    } else {
      return NextResponse.json(
        { error: `${ext || "That file type"} can't be read. Try PDF, Word (.docx), or plain text.` },
        { status: 415 },
      );
    }
  } catch (err) {
    console.error(`Could not extract text from ${name}:`, err);
    return NextResponse.json(
      { error: "That file could not be read. It may be corrupt or password-protected." },
      { status: 422 },
    );
  }

  const tidied = tidy(text);
  if (!tidied) {
    // A scanned PDF is the usual culprit: pages of pictures, no text layer.
    return NextResponse.json(
      {
        error:
          ext === ".pdf"
            ? "No text was found. If this is a scan, it needs to be run through OCR first."
            : "No text was found in that file.",
      },
      { status: 422 },
    );
  }

  const truncated = tidied.length > MAX_CHARS;
  return NextResponse.json({
    name,
    text: truncated ? tidied.slice(0, MAX_CHARS) : tidied,
    truncated,
  });
}
