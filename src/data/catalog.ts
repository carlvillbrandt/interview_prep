import type { IndustrySlug } from "@/lib/schemas";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type IndustryIcon = "chart" | "rocket" | "compass";

export interface Industry {
  slug: IndustrySlug;
  name: string;
  /** One-line description shown on the welcome card. */
  description: string;
  /** Hex accent used for this industry's cards, focus rings and highlights. */
  accent: string;
  icon: IndustryIcon;
}

export interface Company {
  industry: IndustrySlug;
  /** Folder name under /interviews/{industry}/ and the URL segment. */
  slug: string;
  name: string;
  tagline: string;
  /** Featured firms appear in the large top row on the industry page. */
  featured: boolean;
  /** e.g. "Technical + Fit", "Case + PEI", "Pitch + Judgment". */
  interviewStyle: string;
  /** Hex accent for the monogram tile. Defaults to the industry accent. */
  accent?: string;
}

/* ------------------------------------------------------------------ */
/* Industries                                                          */
/* ------------------------------------------------------------------ */

export const INDUSTRIES: readonly Industry[] = [
  {
    slug: "investment-banking",
    name: "Investment Banking",
    description:
      "Technicals on accounting, valuation, DCF and LBOs — plus the fit questions that decide offers.",
    accent: "#E0B65C",
    icon: "chart",
  },
  {
    slug: "venture-capital",
    name: "Venture Capital & Private Equity",
    description:
      "Market sizing, “pitch me a company”, investment theses and the judgment calls partners probe for.",
    accent: "#4FD1A5",
    icon: "rocket",
  },
  {
    slug: "consulting",
    name: "Consulting",
    description:
      "Structured, hypothesis-driven cases and personal-experience interviews, run live.",
    accent: "#7AA7FF",
    icon: "compass",
  },
];

/* ------------------------------------------------------------------ */
/* Companies                                                           */
/*                                                                     */
/* Intentionally empty: firm content is supplied separately.           */
/* Add firms with `npm run scaffold -- --industry <slug> --company     */
/* "<Name>"`, which writes the interview folder and inserts an entry   */
/* at the marker below. Every entry needs a matching folder in         */
/* /interviews/{industry}/{slug}/ — `npm run validate:interviews`      */
/* enforces this.                                                      */
/* ------------------------------------------------------------------ */

const COMPANIES: Company[] = [
  // @scaffold-insert (keep this marker; the scaffold script inserts above it)
];

/** Test-only firm used by the Playwright smoke test. Never present in production builds. */
const E2E_FIXTURE_COMPANIES: Company[] = [
  {
    industry: "consulting",
    slug: "e2e-test-firm",
    name: "Meridian Test Partners",
    tagline: "Fixture firm for automated smoke tests.",
    featured: true,
    interviewStyle: "Case + Fit",
  },
];

/* ------------------------------------------------------------------ */
/* Accessors                                                           */
/* ------------------------------------------------------------------ */

export function allCompanies(): Company[] {
  return process.env.NEXT_PUBLIC_E2E_FIXTURES === "1"
    ? [...COMPANIES, ...E2E_FIXTURE_COMPANIES]
    : COMPANIES;
}

export function getIndustry(slug: string): Industry | undefined {
  return INDUSTRIES.find((i) => i.slug === slug);
}

export function companiesForIndustry(industry: IndustrySlug): Company[] {
  return allCompanies()
    .filter((c) => c.industry === industry)
    .sort((a, b) => Number(b.featured) - Number(a.featured) || a.name.localeCompare(b.name));
}

export function getCompany(industry: string, slug: string): Company | undefined {
  return allCompanies().find((c) => c.industry === industry && c.slug === slug);
}

export function companyAccent(company: Company): string {
  return company.accent ?? getIndustry(company.industry)?.accent ?? "#7AA7FF";
}

/** Up to two letters for the brand-neutral monogram tile, e.g. "Goldman Sachs" → "GS". */
export function monogram(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s&-]/gu, "")
    .split(/[\s-]+/)
    .filter((w) => w && w !== "&" && !/^(and|of|the|co)$/i.test(w));
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
