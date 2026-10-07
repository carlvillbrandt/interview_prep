import { promises as fs } from "node:fs";
import path from "node:path";
import { getCompany } from "@/data/catalog";
import { companyDir } from "@/lib/interviewLoader";

/**
 * Serves a company's knowledge/*.md file as text/plain so Tavus can ingest it via
 * `document_url` (the Documents API only accepts URLs, and not .md). Requested as
 * `{name}.txt`; resolves to `{name}.md` or `{name}.txt` in the company's knowledge folder.
 * These files are public reference material about the firm by design.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ industry: string; company: string; file: string }> }) {
  const { industry, company, file } = await ctx.params;
  if (!getCompany(industry, company) || !/^[A-Za-z0-9._-]+\.txt$/.test(file) || file.includes("..")) {
    return new Response("Not found", { status: 404 });
  }
  const dir = path.join(companyDir(industry, company), "knowledge");
  const base = file.slice(0, -4);
  for (const candidate of [`${base}.md`, `${base}.txt`]) {
    try {
      const text = await fs.readFile(path.join(dir, candidate), "utf8");
      return new Response(text, {
        headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
      });
    } catch {
      // try next
    }
  }
  return new Response("Not found", { status: 404 });
}
