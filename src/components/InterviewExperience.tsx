"use client";

import { AnimatePresence } from "framer-motion";
import { useState } from "react";
import { BackLink } from "@/components/BackLink";
import { Monogram } from "@/components/CompanyCard";
import { CameraIcon } from "@/components/icons";
import { InterviewStage } from "@/components/InterviewStage";
import { PreflightModal, type InterviewSettings, type SetupOptions } from "@/components/PreflightModal";
import { companyMonogram, type Company, type Industry } from "@/data/catalog";

type View = "setup" | "interview";

export function InterviewExperience({
  company,
  industry,
  accent,
  setup,
}: {
  company: Company;
  industry: Industry;
  accent: string;
  setup: SetupOptions;
}) {
  const [view, setView] = useState<View>("setup");
  const [modalOpen, setModalOpen] = useState(true);
  const [settings, setSettings] = useState<InterviewSettings>({ level: setup.levels[0], focus: "Mixed" });

  return (
    <>
      <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-10 sm:px-8" style={{ "--accent": accent } as React.CSSProperties}>
        <BackLink href={`/industry/${industry.slug}`} label={industry.name} />
        <header className="mt-12 flex flex-col gap-6 sm:flex-row sm:items-center">
          <Monogram name={company.name} label={companyMonogram(company)} accent={accent} size="lg" />
          <div>
            <p className="text-xs font-medium tracking-[0.22em] uppercase" style={{ color: accent }}>
              {company.interviewStyle}
            </p>
            <h1 className="font-display mt-2 text-5xl leading-tight text-fg sm:text-6xl">{company.name}</h1>
            <p className="mt-2 text-lg text-fg-muted">{company.tagline}</p>
          </div>
        </header>

        <section className="mt-12 grid gap-4 sm:grid-cols-3" aria-label="What to expect">
          {[
            ["Live, adaptive", "Your interviewer follows up on what you say, probes weak spots and adjusts to your level."],
            [
              `About ${setup.interviewMinutes} minutes`,
              "Intro, core questions, one deep-dive and your questions, run like the real thing.",
            ],
            [
              "Scored debrief",
              setup.inCallDebrief
                ? "A spoken debrief from your interviewer, then a written scorecard with quoted moments and better answers."
                : "An honest rating, category scores and quoted moments with better answers.",
            ],
          ].map(([title, body]) => (
            <div key={title} className="rounded-2xl border border-line bg-ink-900/70 p-5">
              <p className="font-medium text-fg">{title}</p>
              <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">{body}</p>
            </div>
          ))}
        </section>

        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="mt-10 inline-flex items-center gap-2 rounded-full px-6 py-3.5 font-semibold text-ink-950 transition-transform hover:scale-[1.02] active:scale-[0.98]"
          style={{ background: accent }}
        >
          <CameraIcon size={20} />
          Set up interview
        </button>
      </main>

      <PreflightModal
        open={view === "setup" && modalOpen}
        companyName={company.name}
        accent={accent}
        initial={settings}
        setup={setup}
        onClose={() => setModalOpen(false)}
        onStart={(s) => {
          setSettings(s);
          setView("interview");
        }}
      />

      <AnimatePresence>
        {view === "interview" && (
          <InterviewStage
            key="stage"
            company={{ name: company.name, slug: company.slug, industry: company.industry, accent, monogram: companyMonogram(company) }}
            settings={settings}
            onExit={() => {
              setView("setup");
              setModalOpen(true);
            }}
          />
        )}
      </AnimatePresence>
    </>
  );
}
