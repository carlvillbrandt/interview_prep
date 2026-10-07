"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import type { Industry } from "@/data/catalog";
import { ArrowRightIcon, ChartIcon, CompassIcon, RocketIcon } from "@/components/icons";

const ICONS = { chart: ChartIcon, rocket: RocketIcon, compass: CompassIcon };

export function IndustryCard({ industry, count, index }: { industry: Industry; count: number; index: number }) {
  const Icon = ICONS[industry.icon];
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, delay: 0.25 + index * 0.08, ease: [0.16, 1, 0.3, 1] }}
      className="h-full"
    >
      <motion.div whileHover={{ y: -4 }} whileTap={{ scale: 0.985 }} transition={{ type: "spring", stiffness: 400, damping: 30 }} className="h-full">
        <Link
          href={`/industry/${industry.slug}`}
          style={{ "--accent": industry.accent } as React.CSSProperties}
          className="group relative flex h-full min-h-[300px] flex-col overflow-hidden rounded-3xl border border-line bg-ink-900/80 p-7 transition-colors duration-300 hover:[border-color:color-mix(in_srgb,var(--accent)_45%,transparent)] sm:p-8"
          aria-label={`${industry.name}: ${count === 0 ? "firms coming soon" : `${count} firm${count === 1 ? "" : "s"}`}`}
        >
          {/* accent glow */}
          <span
            aria-hidden
            className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full opacity-20 blur-3xl transition-opacity duration-500 group-hover:opacity-40"
            style={{ background: industry.accent }}
          />
          <span
            className="relative flex h-12 w-12 items-center justify-center rounded-2xl border border-line-strong"
            style={{ color: industry.accent, background: `color-mix(in srgb, ${industry.accent} 10%, transparent)` }}
          >
            <Icon size={24} />
          </span>
          <h2 className="font-display relative mt-8 text-3xl leading-tight text-fg sm:text-[2.1rem]">{industry.name}</h2>
          <p className="relative mt-3 text-[0.95rem] leading-relaxed text-fg-muted">{industry.description}</p>
          <div className="relative mt-auto flex items-center justify-between pt-8">
            <span className="text-sm text-fg-subtle">
              {count === 0 ? "Firms coming soon" : `${count} firm${count === 1 ? "" : "s"}`}
            </span>
            <span className="relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-line-strong text-fg transition-all duration-300 group-hover:translate-x-1 group-hover:border-transparent group-hover:text-ink-950">
              <span
                aria-hidden
                className="absolute h-10 w-10 scale-0 rounded-full transition-transform duration-300 group-hover:scale-100"
                style={{ background: industry.accent }}
              />
              <ArrowRightIcon size={18} className="relative" />
            </span>
          </div>
        </Link>
      </motion.div>
    </motion.div>
  );
}
