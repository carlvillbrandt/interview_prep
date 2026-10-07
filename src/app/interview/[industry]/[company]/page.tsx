import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { InterviewExperience } from "@/components/InterviewExperience";
import { InterviewPageSkeleton } from "@/components/Skeletons";
import { companyAccent, getCompany, getIndustry } from "@/data/catalog";

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
  return <InterviewExperience company={company} industry={industry} accent={companyAccent(company)} />;
}
