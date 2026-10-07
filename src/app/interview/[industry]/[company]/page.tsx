import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { InterviewExperience } from "@/components/InterviewExperience";
import { InterviewPageSkeleton } from "@/components/Skeletons";
import { companyAccent, getCompany, getIndustry } from "@/data/catalog";
import { companyDir, DEFAULT_SETTINGS, loadSettings } from "@/lib/interviewLoader";
import { LEVELS_BY_INDUSTRY } from "@/lib/schemas";

type Params = { industry: string; company: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { industry, company } = await params;
  const c = getCompany(industry, company);
  return { title: c ? `${c.name} interview` : "Not found" };
}

export default function InterviewPage({ params }: { params: Promise<Params> }) {
  return (
    <Suspense fallback={<InterviewPageSkeleton />}>
      <InterviewContent params={params} />
    </Suspense>
  );
}

async function InterviewContent({ params }: { params: Promise<Params> }) {
  const { industry: industrySlug, company: companySlug } = await params;
  const industry = getIndustry(industrySlug);
  const company = getCompany(industrySlug, companySlug);
  if (!industry || !company) notFound();
  // Firm settings drive setup copy (duration, debrief) and whether a CV can be attached.
  // An invalid settings.json is reported by validate:interviews and at interview start; fall back to defaults here.
  const { settings } = await loadSettings(companyDir(company.industry, company.slug)).catch(() => ({ settings: DEFAULT_SETTINGS }));
  return (
    <InterviewExperience
      company={company}
      industry={industry}
      accent={companyAccent(company)}
      setup={{
        levels: [...LEVELS_BY_INDUSTRY[industry.slug]],
        interviewMinutes: settings.interviewMinutes,
        inCallDebrief: settings.inCallDebrief,
        cvUpload: settings.cvUpload,
      }}
    />
  );
}
