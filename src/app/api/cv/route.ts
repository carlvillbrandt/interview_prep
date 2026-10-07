import { extractText, getDocumentProxy } from "unpdf";
import { clientIp, errorResponse, jsonError, RateLimiter } from "@/lib/api";
import { cleanCvText } from "@/lib/cv";
import type { CvExtractResponse } from "@/lib/schemas";

/**
 * POST /api/cv (multipart/form-data, field "file": PDF or .txt, ≤ 5 MB)
 *
 * Extracts plain text from the candidate's CV so it can be passed to the interviewer as
 * per-conversation context. Nothing is written to disk; the text only lives in the
 * candidate's browser until they start the interview.
 */

const MAX_BYTES = 5 * 1024 * 1024;

const g = globalThis as unknown as { __preproomCvLimiter?: RateLimiter };
const limiter = (g.__preproomCvLimiter ??= new RateLimiter(20, 10 * 60_000));

export async function POST(req: Request) {
  if (limiter.check(clientIp(req)) > 0) {
    return jsonError(429, "rate_limited", "Too many CV uploads. Please wait a few minutes.");
  }
  try {
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!file || typeof file === "string") return jsonError(400, "invalid_request", "Attach a PDF or .txt file.", false);
    if (file.size === 0) return jsonError(400, "invalid_request", "That file is empty.", false);
    if (file.size > MAX_BYTES) return jsonError(413, "too_large", "Your CV must be smaller than 5 MB.", false);

    const name = file.name || "cv";
    const bytes = new Uint8Array(await file.arrayBuffer());
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(name) || String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-";
    const isText = file.type.startsWith("text/") || /\.(txt|md)$/i.test(name);

    let raw: string;
    let pages = 1;
    if (isPdf) {
      try {
        const pdf = await getDocumentProxy(bytes);
        const result = await extractText(pdf, { mergePages: true });
        raw = result.text;
        pages = result.totalPages;
      } catch {
        return jsonError(422, "unreadable", "We couldn't read that PDF. Try exporting it again, or upload a .txt version.", false);
      }
    } else if (isText) {
      raw = new TextDecoder().decode(bytes);
    } else {
      return jsonError(415, "unsupported", "Upload your CV as a PDF or .txt file.", false);
    }

    const { text, truncated } = cleanCvText(raw);
    if (text.length < 50) {
      return jsonError(
        422,
        "no_text",
        "We couldn't find any text in that file. Scanned PDFs (images) aren't supported. Upload a text-based PDF.",
        false,
      );
    }
    const body: CvExtractResponse = { text, pages, truncated, fileName: name.slice(0, 120) };
    return Response.json(body, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
