"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { companyAccent, monogram, type Company } from "@/data/catalog";
import { ArrowRightIcon } from "@/components/icons";

export function Monogram({ name, accent, size = "md" }: { name: string; accent: string; size?: "sm" | "md" | "lg" }) {
  const dims = { sm: "h-10 w-10 text-base", md: "h-12 w-12 text-lg", lg: "h-16 w-16 text-2xl" }[size];
  return (
    <span
      aria-hidden
      className={`font-display flex shrink-0 items-center justify-center rounded-2xl border ${dims}`}
      style={{
        color: accent,
        borderColor: `color-mix(in srgb, ${accent} 35%, transparent)`,
        background: `linear-gradient(145deg, color-mix(in srgb, ${accent} 16%, transparent), transparent)`,
      }}
    >
      {monogram(name)}
    </span>
  );
}

export function CompanyCard({ company, variant }: { company: Company; variant: "featured" | "compact" }) {
  const accent = companyAccent(company);
  const href = `/interview/${company.industry}/${company.slug}`;

  if (variant === "compact") {
    return (
      <motion.div layout whileHover={{ y: -2 }} whileTap={{ scale: 0.99 }} transition={{ type: "spring", stiffness: 420, damping: 32 }}>
        <Link
          href={href}
          style={{ "--accent": accent } as React.CSSProperties}
          className="group flex items-center gap-4 rounded-2xl border border-line bg-ink-900/70 p-4 transition-colors hover:border-line-strong hover:bg-ink-850"
        >
          <Monogram name={company.name} accent={accent} size="sm" />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-fg">{company.name}</span>
            <span className="block truncate text-sm text-fg-subtle">{company.interviewStyle}</span>
          </span>
          <ArrowRightIcon size={16} className="text-fg-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-fg" />
        </Link>
      </motion.div>
    );
  }

  return (
    <motion.div layout whileHover={{ y: -4 }} whileTap={{ scale: 0.985 }} transition={{ type: "spring", stiffness: 400, damping: 30 }} className="h-full">
      <Link
        href={href}
        style={{ "--accent": accent } as React.CSSProperties}
        className="group relative flex h-full min-h-[230px] flex-col overflow-hidden rounded-3xl border border-line bg-ink-900/80 p-6 transition-colors hover:[border-color:color-mix(in_srgb,var(--accent)_45%,transparent)]"
      >
        <span
          aria-hidden
          className="pointer-events-none absolute -right-16 -bottom-20 h-48 w-48 rounded-full opacity-15 blur-3xl transition-opacity duration-500 group-hover:opacity-30"
          style={{ background: accent }}
        />
        <Monogram name={company.name} accent={accent} size="lg" />
        <h3 className="font-display relative mt-6 text-2xl leading-tight text-fg">{company.name}</h3>
        <p className="relative mt-2 line-clamp-2 text-sm leading-relaxed text-fg-muted">{company.tagline}</p>
        <div className="relative mt-auto flex items-center justify-between pt-6">
          <span
            className="rounded-full border px-3 py-1 text-xs font-medium"
            style={{ color: accent, borderColor: `color-mix(in srgb, ${accent} 35%, transparent)` }}
          >
            {company.interviewStyle}
          </span>
          <ArrowRightIcon size={18} className="text-fg-subtle transition-transform group-hover:translate-x-1 group-hover:text-fg" />
        </div>
      </Link>
    </motion.div>
  );
}
