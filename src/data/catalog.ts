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
  /** Override for the 1–3 letter monogram tile (default: derived from the name). */
  monogram?: string;
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
  {
    industry: "consulting",
    slug: "alixpartners-restructuring",
    name: "AlixPartners",
    tagline: "Turnaround & Restructuring: crisis cases where cash comes first.",
    featured: true,
    interviewStyle: "Turnaround case + Fit",
    monogram: "AP",
  },
  {
    industry: "consulting",
    slug: "simon-kucher-pricing",
    name: "Simon-Kucher",
    tagline: "Pricing & Monetization: customer value, willingness to pay and profit.",
    featured: true,
    interviewStyle: "Pricing case + Fit",
  },
  {
    industry: "consulting",
    slug: "bain-cdd",
    name: "Bain & Company",
    tagline: "Private Equity & Commercial Due Diligence: would you bid?",
    featured: true,
    interviewStyle: "Due-diligence case + Fit",
    monogram: "B",
  },
  {
    industry: "investment-banking",
    slug: "goldman-sachs-tmt",
    name: "Goldman Sachs",
    tagline: "Technology, Media & Telecom: software, internet and digital infrastructure deals.",
    featured: true,
    interviewStyle: "Technicals + Deal case",
  },
  {
    industry: "investment-banking",
    slug: "citi-power-infrastructure",
    name: "Citi",
    tagline: "Power, Utilities & Infrastructure: valuing and financing the energy transition.",
    featured: true,
    interviewStyle: "Technicals + Financing case",
    monogram: "C",
  },
  {
    industry: "investment-banking",
    slug: "houlihan-lokey-industrials",
    name: "Houlihan Lokey",
    tagline: "Corporate Finance – Industrials: Mittelstand sell-sides and valuation.",
    featured: true,
    interviewStyle: "Technicals + Deal case",
  },
  {
    industry: "venture-capital",
    slug: "general-atlantic-growth",
    name: "General Atlantic",
    tagline: "Growth equity: a great company vs a great investment at this price.",
    featured: true,
    interviewStyle: "Returns + Investment case",
  },
  {
    industry: "venture-capital",
    slug: "verdane-pe",
    name: "Verdane",
    tagline: "Growth investing in digitalization and decarbonization.",
    featured: true,
    interviewStyle: "Returns + Investment case",
    monogram: "V",
  },
  {
    industry: "venture-capital",
    slug: "hv-capital-vc",
    name: "HV Capital",
    tagline: "Multistage VC: founders, theses and live startup pitches.",
    featured: true,
    interviewStyle: "Thesis + Live case",
    monogram: "HV",
  },
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
export function companyMonogram(company: Pick<Company, "name" | "monogram">): string {
  return company.monogram ?? monogram(company.name);
}

export function monogram(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s&-]/gu, "")
    .split(/[\s-]+/)
    .filter((w) => w && w !== "&" && !/^(and|of|the|co)$/i.test(w));
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
