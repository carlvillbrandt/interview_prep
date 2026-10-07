/**
 * Pre-warm Tavus resources so the first interview starts instantly.
 *
 *   npm run provision -- --company goldman-sachs [--industry investment-banking] [--verify]
 *   npm run provision:all [-- --verify]
 *
 * Reuses cached IDs when the interview files are unchanged (content hash).
 * --verify fetches the PAL back from Tavus and checks it carries this company's
 * system prompt, objectives and guardrails.
 */
import { allCompanies, type Company } from "../src/data/catalog";
import { tavusApiKey } from "../src/lib/env";
import { buildPalSystemPrompt, loadInterview } from "../src/lib/interviewLoader";
import { provisionCompany, verifyProvisioning } from "../src/lib/provision";
import { TavusClient, TavusError } from "../src/lib/tavus";

function arg(name: string): string | true | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const next = process.argv[i + 1];
  return next && !next.startsWith("--") ? next : true;
}

async function main() {
  const all = arg("all") === true;
  const companySlug = arg("company");
  const industry = arg("industry");
  const verify = arg("verify") === true;

  let targets: Company[];
  if (all) targets = allCompanies();
  else if (typeof companySlug === "string") {
    targets = allCompanies().filter(
      (c) => c.slug === companySlug && (typeof industry !== "string" || c.industry === industry),
    );
    if (targets.length === 0) {
      console.error(`No catalog company with slug "${companySlug}"${typeof industry === "string" ? ` in ${industry}` : ""}.`);
      process.exit(1);
    }
    if (targets.length > 1) {
      console.error(`Slug "${companySlug}" exists in several industries; pass --industry.`);
      process.exit(1);
    }
  } else {
    console.error("Usage: npm run provision -- --company <slug> [--industry <slug>] [--verify]   |   npm run provision:all");
    process.exit(1);
  }
  if (targets.length === 0) {
    console.log("The catalog is empty; nothing to provision.");
    return;
  }

  const client = new TavusClient({ apiKey: tavusApiKey() });
  let failures = 0;
  for (const company of targets) {
    const label = `${company.industry}/${company.slug}`;
    try {
      const r = await provisionCompany(company, { client, log: (m) => console.log(`  · ${m}`) });
      console.log(
        `✔ ${label}: PAL ${r.palId} · objectives ${r.objectivesId} · ${r.guardrailIds.length} guardrails · ${r.documentIds.length} docs · face ${r.faceId}${r.reused ? " (cached)" : ""}`,
      );
      if (verify) {
        const content = await loadInterview(company.industry, company.slug);
        const report = await verifyProvisioning(client, r, buildPalSystemPrompt(content, company.name));
        console.log(`  ${report.ok ? "✔" : "✖"} verify: ${Object.entries(report.checks).map(([k, v]) => `${k}=${v}`).join(", ")}`);
        if (!report.ok) failures++;
      }
    } catch (err) {
      failures++;
      const detail = err instanceof TavusError ? `${err.kind} (${err.status ?? "-"}): ${err.message}` : (err as Error).message;
      console.error(`✖ ${label}: ${detail}`);
    }
  }
  if (failures) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
