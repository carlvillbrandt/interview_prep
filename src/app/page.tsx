import { IndustryCard } from "@/components/IndustryCard";
import { HeroCopy } from "@/components/HeroCopy";
import { companiesForIndustry, INDUSTRIES } from "@/data/catalog";

export default function WelcomePage() {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col justify-center px-5 py-16 sm:px-8 lg:py-24">
      <HeroCopy />
      <section aria-label="Choose an industry" className="mt-14 grid gap-5 md:grid-cols-3 lg:mt-20">
        {INDUSTRIES.map((industry, i) => (
          <IndustryCard
            key={industry.slug}
            industry={industry}
            count={companiesForIndustry(industry.slug).length}
            index={i}
          />
        ))}
      </section>
      <ol className="mt-14 grid gap-6 text-sm text-fg-muted sm:grid-cols-3" aria-label="How it works">
        {[
          ["01", "Pick a firm", "Each firm has its own interviewer, culture and interview structure."],
          ["02", "Interview live on video", "A 30–35 minute face-to-face conversation that adapts to your answers."],
          ["03", "Get a candid debrief", "Your interviewer steps out of role with scores, corrections and better answers."],
        ].map(([n, title, body]) => (
          <li key={n} className="flex gap-4 border-t border-line pt-5">
            <span className="font-display text-xl text-fg-subtle">{n}</span>
            <span>
              <span className="block font-medium text-fg">{title}</span>
              <span className="mt-1 block leading-relaxed">{body}</span>
            </span>
          </li>
        ))}
      </ol>
    </main>
  );
}
