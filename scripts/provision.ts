/**
 * Pre-warm Tavus resources so the first interview starts instantly.
 *
 *   npm run provision -- --company goldman-sachs [--industry investment-banking] [--verify]
 *   npm run provision:all [-- --verify]
 *   npm run provision -- --company bain-cdd --dry-run   (print payloads; no Tavus calls)
 *
 * Reuses cached IDs when the interview files are unchanged (content hash).
 * --verify fetches the PAL back from Tavus and checks it carries this company's
 * system prompt, objectives and guardrails.
 */
import { allCompanies, type Company } from "../src/data/catalog";
import { isPubliclyReachable, tavusApiKey } from "../src/lib/env";
import { buildPalSystemPrompt, knowledgeMode, loadInterview } from "../src/lib/interviewLoader";
import { provisionCompany, verifyProvisioning } from "../src/lib/provision";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileProvisionCacheStore } from "../src/lib/storage";
import { TavusClient, TavusError } from "../src/lib/tavus";

/** A TavusClient that prints request payloads and returns fake IDs. */
class DryRunClient extends TavusClient {
  private n = 0;
  constructor() {
    super({ apiKey: "dry-run" });
  }
  override async request<T>(method: "GET" | "POST" | "PATCH" | "DELETE", p: string, opts: { body?: unknown } = {}): Promise<T> {
    const id = `dry_${++this.n}`;
    if (method === "POST") {
      const body = opts.body as Record<string, unknown>;
      if (p === "/v2/pals") {
        const { system_prompt, ...rest } = body;
        const sp = String(system_prompt);
        console.log(`\n  POST ${p}\n${JSON.stringify(rest, null, 2).replace(/^/gm, "    ")}`);
        console.log(`    system_prompt: ${sp.length} chars (~${Math.round(sp.length / 4)} tokens); sections: ${(sp.match(/^#{2,3} .+$/gm) ?? []).join(" | ")}`);
      } else {
        console.log(`\n  POST ${p}\n${JSON.stringify(body, null, 2).replace(/^/gm, "    ")}`);
      }
      if (p === "/v2/objectives") return { objectives_id: id } as T;
      if (p === "/v2/guardrails") return { uuid: id } as T;
      if (p === "/v2/pals") return { pal_id: id } as T;
    }
    if (method === "GET" && p.startsWith("/v2/faces")) return { data: [{ face_id: "dry_face", status: "completed" }] } as T;
    return {} as T;
  }
}

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
  const dryRun = arg("dry-run") === true;

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

  const client = dryRun ? new DryRunClient() : new TavusClient({ apiKey: tavusApiKey() });
  // Dry runs use a throwaway cache so they never mark anything as provisioned.
  const cache = dryRun ? new FileProvisionCacheStore(path.join(await mkdtemp(path.join(os.tmpdir(), "preproom-dry-")), "cache.json")) : undefined;
  let failures = 0;
  for (const company of targets) {
    const label = `${company.industry}/${company.slug}`;
    try {
      const r = await provisionCompany(company, { client, cache, log: (m) => console.log(`  · ${m}`) });
      console.log(
        `✔ ${label}: PAL ${r.palId} · objectives ${r.objectivesId} · ${r.guardrailIds.length} guardrails · ${r.documentIds.length} docs · face ${r.faceId}${r.reused ? " (cached)" : ""}`,
      );
      if (verify && !dryRun) {
        const content = await loadInterview(company.industry, company.slug);
        const inline = knowledgeMode(content, isPubliclyReachable()) === "inline";
        const report = await verifyProvisioning(client, r, buildPalSystemPrompt(content, company.name, { inlineKnowledge: inline }));
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
