"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useDeferredValue, useId, useMemo, useState } from "react";
import { CompanyCard } from "@/components/CompanyCard";
import { SearchIcon, SparkIcon } from "@/components/icons";
import type { Company, Industry } from "@/data/catalog";

export function CompanyBrowser({ industry, companies }: { industry: Industry; companies: Company[] }) {
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const searchId = useId();

  const filtered = useMemo(() => {
    const q = deferred.trim().toLowerCase();
    if (!q) return companies;
    return companies.filter((c) =>
      [c.name, c.tagline, c.interviewStyle].some((field) => field.toLowerCase().includes(q)),
    );
  }, [companies, deferred]);

  const featured = filtered.filter((c) => c.featured).slice(0, 4);
  const featuredSlugs = new Set(featured.map((c) => c.slug));
  const rest = filtered.filter((c) => !featuredSlugs.has(c.slug));

  if (companies.length === 0) {
    return (
      <div className="mt-12 flex flex-col items-center rounded-3xl border border-dashed border-line-strong bg-ink-900/50 px-6 py-20 text-center">
        <span
          className="flex h-14 w-14 items-center justify-center rounded-2xl border border-line-strong"
          style={{ color: industry.accent }}
        >
          <SparkIcon size={26} />
        </span>
        <h2 className="font-display mt-6 text-3xl text-fg">Firms are on their way</h2>
        <p className="mt-3 max-w-md text-fg-muted">
          We&apos;re building {industry.name.toLowerCase()} interviewers with firm-specific culture, structure and
          questions. Check back soon.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="mt-8 max-w-md">
        <label htmlFor={searchId} className="sr-only">
          Search firms
        </label>
        <div className="relative">
          <SearchIcon size={18} className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-fg-subtle" />
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search firms or interview style"
            autoComplete="off"
            className="w-full rounded-2xl border border-line bg-ink-900/80 py-3 pr-4 pl-11 text-fg placeholder:text-fg-subtle focus:border-line-strong focus:outline-none focus-visible:outline-2"
          />
        </div>
      </div>

      {featured.length > 0 && (
        <section aria-labelledby="featured-heading" className="mt-10">
          <h2 id="featured-heading" className="text-xs font-medium tracking-[0.2em] text-fg-subtle uppercase">
            Featured
          </h2>
          <motion.ul layout className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <AnimatePresence initial={false}>
              {featured.map((c) => (
                <motion.li
                  key={c.slug}
                  layout
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={{ duration: 0.25 }}
                >
                  <CompanyCard company={c} variant="featured" />
                </motion.li>
              ))}
            </AnimatePresence>
          </motion.ul>
        </section>
      )}

      {rest.length > 0 && (
        <section aria-labelledby="all-heading" className="mt-12">
          <h2 id="all-heading" className="text-xs font-medium tracking-[0.2em] text-fg-subtle uppercase">
            All firms
          </h2>
          <motion.ul layout className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <AnimatePresence initial={false}>
              {rest.map((c) => (
                <motion.li
                  key={c.slug}
                  layout
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <CompanyCard company={c} variant="compact" />
                </motion.li>
              ))}
            </AnimatePresence>
          </motion.ul>
        </section>
      )}

      {filtered.length === 0 && (
        <p role="status" className="mt-12 text-fg-muted">
          No firms match “{query}”.
        </p>
      )}
    </>
  );
}
