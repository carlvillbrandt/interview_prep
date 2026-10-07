/**
 * npm run scaffold -- --industry consulting --company "Oliver Wyman" [options]
 *
 * Creates /interviews/{industry}/{slug}/ from /interviews/_templates/{industry}/,
 * injecting the firm name and interview style, then adds the firm to src/data/catalog.ts
 * at the `@scaffold-insert` marker.
 *
 * Options:
 *   --slug <slug>         Folder/URL slug (default: derived from the name)
 *   --tagline <text>      One-line tagline for the card
 *   --style <text>        Interview style label, e.g. "Case + Fit"
 *   --featured            Show in the featured row
 *   --accent <#hex>       Monogram accent (default: industry accent)
 *   --no-catalog          Only write the folder; don't edit catalog.ts
 *   --force               Overwrite an existing folder
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { getCompany, INDUSTRIES } from "../src/data/catalog";
import {
  companyDir,
  INTERVIEW_FILES,
  loadInterviewFromDir,
  templatesRoot,
  validateInterviewContent,
} from "../src/lib/interviewLoader";

const DEFAULT_STYLE: Record<string, string> = {
  "investment-banking": "Technical + Fit",
  "venture-capital": "Pitch + Judgment",
  consulting: "Case + Fit",
};

function parseArgs(argv: string[]) {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const tsString = (s: string) => JSON.stringify(s);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const industry = String(args.industry ?? "");
  const name = typeof args.company === "string" ? args.company.trim() : "";
  if (!INDUSTRIES.some((i) => i.slug === industry) || !name) {
    console.error(
      `Usage: npm run scaffold -- --industry <${INDUSTRIES.map((i) => i.slug).join("|")}> --company "Firm Name" [--slug x] [--tagline "..."] [--style "..."] [--featured] [--accent #hex] [--no-catalog] [--force]`,
    );
    process.exit(1);
  }
  const slug = typeof args.slug === "string" ? args.slug : slugify(name);
  const style = typeof args.style === "string" ? args.style : DEFAULT_STYLE[industry];
  const tagline = typeof args.tagline === "string" ? args.tagline : `Practice a ${style.toLowerCase()} interview with ${name}.`;
  const featured = args.featured === true;
  const accent = typeof args.accent === "string" ? args.accent : undefined;
  if (accent && !/^#[0-9a-fA-F]{6}$/.test(accent)) {
    console.error("--accent must be a hex colour like #7AA7FF");
    process.exit(1);
  }

  // 1. Folder from template.
  const dest = companyDir(industry, slug);
  const exists = await fs.stat(dest).then(() => true, () => false);
  if (exists && !args.force) {
    console.error(`${path.relative(process.cwd(), dest)} already exists. Use --force to overwrite.`);
    process.exit(1);
  }
  await fs.mkdir(dest, { recursive: true });
  const src = path.join(templatesRoot(), industry);
  for (const file of INTERVIEW_FILES) {
    const text = await fs.readFile(path.join(src, file), "utf8");
    const rendered = text.replaceAll("{{company_name}}", name).replaceAll("{{interview_style}}", style);
    await fs.writeFile(path.join(dest, file), rendered, "utf8");
  }
  await fs.mkdir(path.join(dest, "knowledge"), { recursive: true });
  const readme = path.join(dest, "knowledge", "README.md");
  if (!(await fs.stat(readme).then(() => true, () => false))) {
    await fs.writeFile(
      readme,
      `# ${name}: knowledge\n\nOptional reference material (.md) for the interviewer, e.g. firm overview, groups, culture, public deals.\nUploaded to the Tavus knowledge base when APP_BASE_URL is publicly reachable. Delete this README if unused.\n`,
      "utf8",
    );
  }
  console.log(`✔ wrote ${path.relative(process.cwd(), dest)}/{${INTERVIEW_FILES.join(",")}}`);

  // 2. Validate the generated folder.
  const content = await loadInterviewFromDir(dest, { industry, slug });
  const report = validateInterviewContent(content, { featured: false });
  for (const w of report.warnings) console.warn(`  ⚠ ${w}`);
  for (const e of report.errors) console.error(`  ✖ ${e}`);
  if (report.errors.length) process.exit(1);

  // 3. Catalog entry.
  if (args["no-catalog"]) return;
  if (getCompany(industry, slug)) {
    console.log(`• ${industry}/${slug} is already in the catalog; left unchanged.`);
    return;
  }
  const catalogPath = path.join(process.cwd(), "src", "data", "catalog.ts");
  const catalog = await fs.readFile(catalogPath, "utf8");
  const marker = "  // @scaffold-insert";
  if (!catalog.includes(marker)) {
    console.error(`Marker "${marker.trim()}" not found in src/data/catalog.ts; add the entry manually.`);
    process.exit(1);
  }
  const entry = [
    "  {",
    `    industry: ${tsString(industry)},`,
    `    slug: ${tsString(slug)},`,
    `    name: ${tsString(name)},`,
    `    tagline: ${tsString(tagline)},`,
    `    featured: ${featured},`,
    `    interviewStyle: ${tsString(style)},`,
    ...(accent ? [`    accent: ${tsString(accent)},`] : []),
    "  },",
  ].join("\n");
  await fs.writeFile(catalogPath, catalog.replace(marker, `${entry}\n${marker}`), "utf8");
  console.log(`✔ added ${industry}/${slug} to src/data/catalog.ts`);
  console.log(`\nNext: edit the four files in ${path.relative(process.cwd(), dest)}/ to make the interviewer firm-specific, then run npm run validate:interviews.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
