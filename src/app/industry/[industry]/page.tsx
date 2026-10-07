import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BackLink } from "@/components/BackLink";
import { CompanyBrowser } from "@/components/CompanyBrowser";
import { IndustryPageSkeleton } from "@/components/Skeletons";
import { companiesForIndustry, getIndustry, INDUSTRIES } from "@/data/catalog";

type Params = { industry: string };

export function generateStaticParams(): Params[] {
  return INDUSTRIES.map((i) => ({ industry: i.slug }));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const industry = getIndustry((await params).industry);
  return { title: industry ? `${industry.name} interviews` : "Not found" };
}

export default function IndustryPage({ params }: { params: Promise<Params> }) {
  return (
    <Suspense fallback={<IndustryPageSkeleton />}>
      <IndustryContent params={params} />
    </Suspense>
  );
}

async function IndustryContent({ params }: { params: Promise<Params> }) {
  const industry = getIndustry((await params).industry);
  if (!industry) notFound();
  const companies = companiesForIndustry(industry.slug);

  return (
    <main
      className="mx-auto w-full max-w-7xl flex-1 px-5 py-10 sm:px-8"
      style={{ "--accent": industry.accent } as React.CSSProperties}
    >
      <BackLink href="/" label="All industries" />
      <header className="mt-10">
        <p className="text-xs font-medium tracking-[0.22em] uppercase" style={{ color: industry.accent }}>
          Choose your firm
        </p>
        <h1 className="font-display mt-3 text-5xl leading-tight text-fg sm:text-6xl">{industry.name}</h1>
        <p className="mt-4 max-w-2xl text-lg text-fg-muted">{industry.description}</p>
      </header>
      <CompanyBrowser industry={industry} companies={companies} />
    </main>
  );
}
