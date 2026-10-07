/**
 * npm run validate:interviews
 *
 * Validates the industry templates and every company in the catalog: all four files
 * present, parseable, within Tavus limits and the content rules in DECISIONS.md §8.
 * Exits non-zero on any error (runs automatically before `npm run build`).
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { allCompanies, INDUSTRIES } from "../src/data/catalog";
import {
  companyDir,
  InterviewParseError,
  interviewsRoot,
  loadInterviewFromDir,
  RUNTIME_PLACEHOLDERS,
  templatesRoot,
  validateInterviewContent,
} from "../src/lib/interviewLoader";

const errors: string[] = [];
const warnings: string[] = [];
let checked = 0;

async function check(dir: string, meta: { industry: string; slug: string }, opts: Parameters<typeof validateInterviewContent>[1]) {
  checked++;
  try {
    const content = await loadInterviewFromDir(dir, meta);
    const report = validateInterviewContent(content, opts);
    errors.push(...report.errors);
    warnings.push(...report.warnings);
  } catch (err) {
    errors.push(err instanceof InterviewParseError ? err.message : `${dir}: ${(err as Error).message}`);
  }
}

async function main() {
  // 1. Templates (may also use {{interview_style}}, which the scaffold fills in).
  for (const industry of INDUSTRIES) {
    await check(path.join(templatesRoot(), industry.slug), { industry: industry.slug, slug: "_template" }, {
      featured: false,
      allowedPlaceholders: [...RUNTIME_PLACEHOLDERS, "interview_style"],
    });
  }

  // 2. Catalog integrity.
  const companies = allCompanies();
  const seen = new Set<string>();
  for (const c of companies) {
    const key = `${c.industry}/${c.slug}`;
    if (seen.has(key)) errors.push(`catalog: duplicate company ${key}`);
    seen.add(key);
    if (!INDUSTRIES.some((i) => i.slug === c.industry)) errors.push(`catalog: ${key} has unknown industry`);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(c.slug)) errors.push(`catalog: ${key} slug must be kebab-case`);
  }
  const featuredCounts = INDUSTRIES.map((i) => [i.slug, companies.filter((c) => c.industry === i.slug && c.featured).length] as const);
  for (const [slug, n] of featuredCounts) {
    if (n > 4) warnings.push(`catalog: ${slug} has ${n} featured firms; only the first 4 are shown in the featured row`);
  }

  // 3. Every catalog company must have a valid folder.
  for (const c of companies) {
    await check(companyDir(c.industry, c.slug), { industry: c.industry, slug: c.slug }, { featured: c.featured });
  }

  // 4. Orphan folders (present on disk but not clickable).
  for (const industry of INDUSTRIES) {
    const dir = path.join(interviewsRoot(), industry.slug);
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (e.isDirectory() && !companies.some((c) => c.industry === industry.slug && c.slug === e.name)) {
        warnings.push(`${path.relative(process.cwd(), path.join(dir, e.name))}: folder is not in the catalog (src/data/catalog.ts)`);
      }
    }
  }

  for (const w of warnings) console.warn(`  ⚠ ${w}`);
  for (const e of errors) console.error(`  ✖ ${e}`);
  const summary = `${checked} interview folder(s) checked (${INDUSTRIES.length} templates, ${companies.length} catalog firms): ${errors.length} error(s), ${warnings.length} warning(s).`;
  if (errors.length) {
    console.error(`\nvalidate:interviews failed: ${summary}`);
    process.exit(1);
  }
  console.log(`validate:interviews passed: ${summary}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
