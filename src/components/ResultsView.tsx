"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Monogram } from "@/components/CompanyCard";
import {
  CategoryBars,
  KeyMoments,
  ListCard,
  NextSteps,
  SpokenOnlyNotice,
  TranscriptPanel,
} from "@/components/FeedbackPanel";
import { AlertIcon, CheckIcon, CopyIcon, RefreshIcon } from "@/components/icons";
import { ScoreDial, signalColor } from "@/components/ScoreDial";
import { ResultsSkeleton } from "@/components/Skeletons";
import { useToast } from "@/components/Toast";
import { companyMonogram, getCompany, getIndustry } from "@/data/catalog";
import { ApiErrorSchema, CATEGORY_KEYS, CATEGORY_LABELS, type PublicInterviewResult } from "@/lib/schemas";

type LoadState =
  | { kind: "loading" }
  | { kind: "pending"; record: PublicInterviewResult | null; slow: boolean }
  | { kind: "ready"; record: PublicInterviewResult }
  | { kind: "error"; message: string };

const SLOW_AFTER_MS = 100_000;
const GIVE_UP_AFTER_MS = 240_000;

export function ResultsView({ conversationId }: { conversationId: string }) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [pollKey, setPollKey] = useState(0);
  const toast = useToast();
  const startedRef = useRef(0);

  // Poll with backoff until the result is ready.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let delay = 1000;
    startedRef.current = Date.now();

    const poll = async (retry = false) => {
      try {
        const res = await fetch(`/api/interview/${encodeURIComponent(conversationId)}/result${retry ? "?retry=1" : ""}`, {
          cache: "no-store",
        });
        const json = await res.json().catch(() => null);
        if (cancelled) return;
        if (res.status === 200) {
          const record = json as PublicInterviewResult;
          setState({ kind: "ready", record });
          const awaitingTranscript = record.status === "ended" && !record.transcript && !record.completedAt;
          if (!awaitingTranscript || Date.now() - startedRef.current > GIVE_UP_AFTER_MS) return;
          timer = setTimeout(() => void poll(), 4000);
          return;
        }
        if (res.status === 202) {
          const waited = Date.now() - startedRef.current;
          if (waited > GIVE_UP_AFTER_MS) {
            setState({ kind: "error", message: "Generating feedback is taking much longer than usual. Your interview is saved; check back in a few minutes." });
            return;
          }
          setState({ kind: "pending", record: json as PublicInterviewResult, slow: waited > SLOW_AFTER_MS });
        } else {
          const parsed = ApiErrorSchema.safeParse(json);
          setState({ kind: "error", message: parsed.success ? parsed.data.error.message : "We couldn't load your results." });
          return;
        }
      } catch {
        if (cancelled) return;
        // Network blip: keep polling, it may recover.
      }
      timer = setTimeout(() => void poll(), delay);
      delay = Math.min(Math.round(delay * 1.4), 5000);
    };
    void poll(pollKey > 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [conversationId, pollKey]);

  const retryScoring = useCallback(() => {
    setState({ kind: "pending", record: null, slow: false });
    setPollKey((k) => k + 1);
  }, []);

  if (state.kind === "loading" || state.kind === "pending") {
    const record = state.kind === "pending" ? state.record : null;
    return (
      <Shell record={record}>
        <div role="status" aria-live="polite" className="mb-8 flex items-center gap-3 text-fg-muted">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-line-strong border-t-azure motion-reduce:animate-none" aria-hidden />
          <span>
            Generating your feedback…{" "}
            <span className="text-fg-subtle">
              {state.kind === "pending" && state.slow
                ? "This is taking longer than usual, hang tight."
                : record?.status === "active"
                  ? "Wrapping up the call."
                  : "Fetching the transcript and scoring your answers (usually under a minute)."}
            </span>
          </span>
        </div>
        <ResultsSkeleton />
      </Shell>
    );
  }

  if (state.kind === "error") {
    return (
      <Shell record={null}>
        <Notice
          title="We couldn't load your results"
          body={state.message}
          actions={
            <button type="button" onClick={() => setPollKey((k) => k + 1)} className="btn-secondary inline-flex items-center gap-2 rounded-full border border-line-strong px-5 py-2.5 text-sm text-fg hover:bg-ink-800">
              <RefreshIcon size={16} /> Try again
            </button>
          }
        />
      </Shell>
    );
  }

  const { record } = state;
  const industry = getIndustry(record.industry);
  const accent = industry?.accent ?? "#7AA7FF";
  const retryHref = `/interview/${record.industry}/${record.company}`;
  const anotherHref = `/industry/${record.industry}`;

  if (record.status === "ended") {
    return (
      <Shell record={record}>
        <div className="rounded-3xl border border-line bg-ink-900/70 p-8 sm:p-10">
          <CheckIcon size={28} className="text-success" />
          <h2 className="font-display mt-4 text-3xl text-fg">Interview complete</h2>
          <p className="mt-3 max-w-2xl leading-relaxed text-fg-muted">
            Your interviewer&apos;s spoken debrief was your feedback for this session. Note down the scores and the
            improvements they named, then run the interview again and practice your weakest answer.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href={retryHref} className="rounded-full px-6 py-3 text-sm font-semibold text-ink-950 transition-transform hover:scale-[1.02]" style={{ background: accent }}>
              Retry this interview
            </Link>
            <Link href={anotherHref} className="rounded-full border border-line-strong px-6 py-3 text-sm text-fg hover:bg-ink-800">
              Try another firm
            </Link>
          </div>
        </div>
        <div className="mt-8">
          {record.transcript && record.transcript.length > 0 ? (
            <TranscriptPanel transcript={record.transcript} interviewerLabel="Interviewer" />
          ) : record.completedAt ? (
            <p className="text-sm text-fg-subtle">A transcript isn&apos;t available for this call.</p>
          ) : (
            <p role="status" className="flex items-center gap-2 text-sm text-fg-subtle">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-line-strong border-t-azure motion-reduce:animate-none" aria-hidden />
              Preparing your transcript…
            </p>
          )}
        </div>
      </Shell>
    );
  }

  if (record.status !== "complete" || !record.scoring) {
    const failed = record.status === "failed";
    return (
      <Shell record={record}>
        <Notice
          title={failed ? "We couldn't score this interview" : "Not enough to score, honestly"}
          body={record.message ?? "This session didn't produce enough of your answers to assess fairly. We never guess a score."}
          actions={
            <>
              {failed && (
                <button
                  type="button"
                  onClick={retryScoring}
                  className="inline-flex items-center gap-2 rounded-full border border-line-strong px-5 py-2.5 text-sm text-fg hover:bg-ink-800"
                >
                  <RefreshIcon size={16} /> Retry scoring
                </button>
              )}
              <Link href={retryHref} className="rounded-full px-5 py-2.5 text-sm font-semibold text-ink-950" style={{ background: accent }}>
                Retry this interview
              </Link>
              <Link href={anotherHref} className="rounded-full border border-line px-5 py-2.5 text-sm text-fg-muted hover:text-fg">
                Try another firm
              </Link>
            </>
          }
        />
        {record.transcript && record.transcript.length > 0 && (
          <div className="mt-8">
            <TranscriptPanel transcript={record.transcript} interviewerLabel="Interviewer" />
          </div>
        )}
      </Shell>
    );
  }

  const s = record.scoring;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(feedbackAsText(record));
      toast.success("Feedback copied", "Paste it into your notes or share it with a coach.");
    } catch {
      toast.error("Couldn't copy", "Your browser blocked clipboard access.");
    }
  };

  return (
    <Shell record={record}>
      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="flex flex-col items-center rounded-3xl border border-line bg-ink-900/70 p-7 text-center"
          aria-labelledby="overall-heading"
        >
          <h2 id="overall-heading" className="sr-only">
            Overall rating
          </h2>
          <ScoreDial score={s.overall_score} signal={s.hire_signal} />
          <span
            className="mt-2 rounded-full border px-4 py-1.5 text-sm font-semibold"
            style={{ color: signalColor(s.hire_signal), borderColor: `color-mix(in srgb, ${signalColor(s.hire_signal)} 40%, transparent)` }}
          >
            {s.hire_signal}
          </span>
          <p className="mt-5 leading-relaxed text-fg-muted">{s.summary}</p>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
          className="rounded-3xl border border-line bg-ink-900/70 p-6 sm:p-8"
          aria-labelledby="categories-heading"
        >
          <h2 id="categories-heading" className="font-display text-2xl text-fg">
            Category scores
          </h2>
          <div className="mt-6">
            <CategoryBars categories={s.categories} accent={accent} />
          </div>
        </motion.section>
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <ListCard title="Strengths" items={s.strengths} tone="good" />
        <ListCard title="Areas to improve" items={s.improvements} tone="improve" />
      </div>

      <div className="mt-12">
        <KeyMoments moments={s.key_moments} accent={accent} />
      </div>

      <div className="mt-12">
        <NextSteps steps={s.next_steps} accent={accent} />
      </div>

      <div className="mt-6">{!record.perceptionAvailable && <SpokenOnlyNotice />}</div>

      {record.transcript && (
        <div className="mt-8">
          <TranscriptPanel transcript={record.transcript} interviewerLabel="Interviewer" />
        </div>
      )}

      <div className="mt-10 flex flex-wrap gap-3">
        <Link href={retryHref} className="rounded-full px-6 py-3 text-sm font-semibold text-ink-950 transition-transform hover:scale-[1.02]" style={{ background: accent }}>
          Retry this interview
        </Link>
        <Link href={anotherHref} className="rounded-full border border-line-strong px-6 py-3 text-sm text-fg hover:bg-ink-800">
          Try another firm
        </Link>
        <button type="button" onClick={copy} className="inline-flex items-center gap-2 rounded-full border border-line px-6 py-3 text-sm text-fg-muted hover:border-line-strong hover:text-fg">
          <CopyIcon size={16} /> Copy feedback
        </button>
      </div>
    </Shell>
  );
}

function Shell({ record, children }: { record: PublicInterviewResult | null; children: React.ReactNode }) {
  const industry = record ? getIndustry(record.industry) : undefined;
  const accent = industry?.accent ?? "#7AA7FF";
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-10 sm:px-8" style={{ "--accent": accent } as React.CSSProperties}>
      <header className="mb-10 flex min-h-[64px] items-center gap-5">
        {record ? (
          <>
            <Monogram
              name={record.companyName}
              label={companyMonogram(getCompany(record.industry, record.company) ?? { name: record.companyName })}
              accent={accent}
              size="lg"
            />
            <div>
              <p className="text-xs font-medium tracking-[0.22em] text-fg-subtle uppercase">Interview debrief</p>
              <h1 className="font-display mt-1 text-4xl leading-tight text-fg sm:text-5xl">{record.companyName}</h1>
              <p className="mt-1 text-sm text-fg-muted">
                {record.level} · {record.focus} focus · {new Date(record.createdAt).toLocaleDateString(undefined, { dateStyle: "medium" })}
              </p>
            </div>
          </>
        ) : (
          <div>
            <p className="text-xs font-medium tracking-[0.22em] text-fg-subtle uppercase">Interview debrief</p>
            <div className="skeleton mt-2 h-11 w-72" />
          </div>
        )}
      </header>
      {children}
    </main>
  );
}

function Notice({ title, body, actions }: { title: string; body: string; actions: React.ReactNode }) {
  return (
    <div className="rounded-3xl border border-line bg-ink-900/70 p-8 sm:p-10">
      <AlertIcon size={28} className="text-warning" />
      <h2 className="font-display mt-4 text-3xl text-fg">{title}</h2>
      <p className="mt-3 max-w-2xl leading-relaxed text-fg-muted">{body}</p>
      <div className="mt-8 flex flex-wrap gap-3">{actions}</div>
    </div>
  );
}

export function feedbackAsText(record: PublicInterviewResult): string {
  const s = record.scoring;
  if (!s) return "";
  const lines = [
    `PrepRoom debrief: ${record.companyName} (${record.level}, ${record.focus} focus)`,
    `Overall: ${s.overall_score.toFixed(1)}/10, ${s.hire_signal}`,
    "",
    s.summary,
    "",
    "Category scores",
    ...CATEGORY_KEYS.map((k) => `- ${CATEGORY_LABELS[k]}: ${s.categories[k].score}/10. ${s.categories[k].comment}`),
    "",
    "Strengths",
    ...s.strengths.map((x) => `- ${x}`),
    "",
    "Areas to improve",
    ...s.improvements.map((x) => `- ${x}`),
  ];
  if (s.key_moments.length) {
    lines.push("", "Specific moments");
    for (const m of s.key_moments) {
      lines.push(`- "${m.quote}"`, `  Issue: ${m.issue}`, `  Better: ${m.better_answer}`);
    }
  }
  lines.push("", "Next steps", ...s.next_steps.map((x, i) => `${i + 1}. ${x}`));
  if (!record.perceptionAvailable) lines.push("", "(Based on spoken content only.)");
  return lines.join("\n");
}
