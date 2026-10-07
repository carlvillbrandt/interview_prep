/**
 * npm run check:secrets   (run after `npm run build`)
 *
 * Greps the client bundle (.next/static) for secret values and server-only markers.
 * Fails if any API key value, key name or Tavus endpoint shows up in browser code.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

const STATIC_DIR = path.join(process.cwd(), ".next", "static");

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.(js|mjs|css|json|html|txt)$/.test(entry.name)) yield full;
  }
}

async function loadEnvFiles(): Promise<Record<string, string>> {
  const values: Record<string, string> = {};
  for (const file of [".env", ".env.local", ".env.production", ".env.production.local"]) {
    const text = await fs.readFile(path.join(process.cwd(), file), "utf8").catch(() => "");
    for (const line of text.split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m) values[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  return values;
}

async function main() {
  try {
    await fs.access(STATIC_DIR);
  } catch {
    console.error("No .next/static directory. Run `npm run build` first.");
    process.exit(1);
  }
  const env = { ...(await loadEnvFiles()), ...process.env };
  const secretNames = ["TAVUS_API_KEY", "ANTHROPIC_API_KEY", "TAVUS_WEBHOOK_SECRET"];
  const needles: { label: string; value: string }[] = [
    ...secretNames.map((n) => ({ label: `variable name ${n}`, value: n })),
    { label: "Tavus API host", value: "tavusapi.com" },
    { label: "x-api-key header", value: "x-api-key" },
    { label: "Anthropic API host", value: "api.anthropic.com" },
  ];
  for (const n of secretNames) {
    const v = env[n];
    if (v && v.length >= 8) needles.push({ label: `value of ${n}`, value: v });
  }

  let files = 0;
  const hits: string[] = [];
  for await (const file of walk(STATIC_DIR)) {
    files++;
    const text = await fs.readFile(file, "utf8");
    for (const n of needles) {
      if (text.includes(n.value)) hits.push(`${path.relative(process.cwd(), file)}: contains ${n.label}`);
    }
  }
  if (hits.length) {
    console.error(`✖ Secret check failed:\n${hits.map((h) => `  ${h}`).join("\n")}`);
    process.exit(1);
  }
  console.log(`✔ No secrets or server-only markers found in ${files} client bundle files (${needles.length} patterns checked).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
