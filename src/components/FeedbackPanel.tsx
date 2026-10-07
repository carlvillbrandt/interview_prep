"use client";

import { motion } from "framer-motion";
import { useId, useState } from "react";
import { CheckIcon, ChevronDownIcon } from "@/components/icons";
import { CATEGORY_KEYS, CATEGORY_LABELS, type ScoringResult, type TranscriptTurn } from "@/lib/schemas";

// Mount-time (not in-view) animation so content is never left invisible for print or screenshots.
const fadeUp = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.6, delay: 0.25, ease: [0.16, 1, 0.3, 1] as const },
};

export function CategoryBars({ categories, accent }: { categories: ScoringResult["categories"]; accent: string }) {
  return (
    <ul className="space-y-5">
      {CATEGORY_KEYS.map((key, i) => {
        const { score, comment } = categories[key];
        return (
          <li key={key}>
            <div className="flex items-baseline justify-between gap-4">
              <span className="font-medium text-fg">{CATEGORY_LABELS[key]}</span>
              <span className="font-mono text-sm text-fg-muted tabular-nums">{score}/10</span>
            </div>
            <div
              className="mt-2 h-2 overflow-hidden rounded-full bg-ink-700"
              role="meter"
              aria-label={CATEGORY_LABELS[key]}
              aria-valuemin={0}
              aria-valuemax={10}
              aria-valuenow={score}
            >
              <motion.div
                className="h-full rounded-full"
                style={{ background: accent }}
                initial={{ width: 0 }}
                animate={{ width: `${score * 10}%` }}
                transition={{ duration: 1.1, delay: 0.3 + i * 0.08, ease: [0.16, 1, 0.3, 1] }}
              />
            </div>
            <p className="mt-2 text-sm leading-relaxed text-fg-muted">{comment}</p>
          </li>
        );
      })}
    </ul>
  );
}

export function ListCard({ title, items, tone }: { title: string; items: string[]; tone: "good" | "improve" }) {
  return (
    <motion.section {...fadeUp} className="rounded-3xl border border-line bg-ink-900/70 p-6 sm:p-7">
      <h2 className="font-display text-2xl text-fg">{title}</h2>
      <ul className="mt-4 space-y-3">
        {items.map((item, i) => (
          <li key={i} className="flex gap-3 leading-relaxed text-fg-muted">
            <span
              className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${tone === "good" ? "bg-success" : "bg-warning"}`}
              aria-hidden
            />
            {item}
          </li>
        ))}
      </ul>
    </motion.section>
  );
}

export function KeyMoments({ moments, accent }: { moments: ScoringResult["key_moments"]; accent: string }) {
  if (moments.length === 0) return null;
  return (
    <motion.section {...fadeUp} aria-labelledby="moments-heading">
      <h2 id="moments-heading" className="font-display text-3xl text-fg">
        Specific moments
      </h2>
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        {moments.map((m, i) => (
          <article key={i} className="flex flex-col rounded-3xl border border-line bg-ink-900/70 p-6">
            <blockquote className="font-display border-l-2 pl-4 text-xl leading-snug text-fg italic" style={{ borderColor: accent }}>
              “{m.quote}”
            </blockquote>
            <p className="mt-4 text-sm leading-relaxed text-fg-muted">
              <span className="font-medium text-fg">What happened: </span>
              {m.issue}
            </p>
            <div className="mt-4 rounded-2xl bg-ink-850 p-4">
              <p className="text-xs font-medium tracking-wider text-success uppercase">A stronger answer</p>
              <p className="mt-1.5 text-sm leading-relaxed text-fg">{m.better_answer}</p>
            </div>
          </article>
        ))}
      </div>
    </motion.section>
  );
}

export function NextSteps({ steps, accent }: { steps: string[]; accent: string }) {
  return (
    <motion.section {...fadeUp} className="rounded-3xl border border-line bg-ink-900/70 p-6 sm:p-8" aria-labelledby="next-heading">
      <h2 id="next-heading" className="font-display text-3xl text-fg">
        Next steps
      </h2>
      <ol className="mt-5 grid gap-4 md:grid-cols-3">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-4">
            <span
              className="font-display flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-lg"
              style={{ color: accent, borderColor: `color-mix(in srgb, ${accent} 40%, transparent)` }}
            >
              {i + 1}
            </span>
            <p className="leading-relaxed text-fg-muted">{s}</p>
          </li>
        ))}
      </ol>
    </motion.section>
  );
}

export function TranscriptPanel({ transcript, interviewerLabel }: { transcript: TranscriptTurn[]; interviewerLabel: string }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <section className="rounded-3xl border border-line bg-ink-900/70">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center justify-between gap-4 rounded-3xl p-6 text-left sm:px-8"
      >
        <span>
          <span className="font-display block text-2xl text-fg">Full transcript</span>
          <span className="mt-1 block text-sm text-fg-subtle">{transcript.length} turns</span>
        </span>
        <ChevronDownIcon className={`shrink-0 text-fg-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      <div id={panelId} hidden={!open} className="border-t border-line px-6 pt-4 pb-8 sm:px-8">
        <ol className="space-y-4">
          {transcript.map((t, i) => (
            <li key={i} className="grid gap-1 sm:grid-cols-[120px_1fr] sm:gap-4">
              <span className={`text-xs font-medium tracking-wider uppercase ${t.role === "candidate" ? "text-azure" : "text-fg-subtle"}`}>
                {t.role === "candidate" ? "You" : interviewerLabel}
              </span>
              <p className="leading-relaxed text-fg-muted">{t.content}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export function SpokenOnlyNotice() {
  return (
    <p className="flex items-start gap-2 text-sm text-fg-subtle">
      <CheckIcon size={16} className="mt-0.5 shrink-0" />
      Feedback is based on spoken content only. Visual cues like eye contact and body language were not assessed.
    </p>
  );
}
