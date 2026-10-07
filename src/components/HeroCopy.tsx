"use client";

import { motion } from "framer-motion";

export function HeroCopy() {
  return (
    <header className="max-w-4xl">
      <motion.p
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="flex items-center gap-3 text-xs font-medium tracking-[0.22em] text-fg-subtle uppercase"
      >
        <span className="inline-block h-px w-8 bg-fg-subtle" aria-hidden />
        PrepRoom
      </motion.p>
      <motion.h1
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.05, ease: [0.16, 1, 0.3, 1] }}
        className="font-display mt-6 text-5xl leading-[1.02] text-fg sm:text-6xl lg:text-[5.5rem]"
      >
        Walk into the room <em className="text-fg-muted">already prepared.</em>
      </motion.h1>
      <motion.p
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
        className="mt-6 max-w-2xl text-lg leading-relaxed text-fg-muted"
      >
        Run a live, face-to-face mock interview with an AI interviewer modelled on your target firm, then get a
        candid debrief built from what you actually said.
      </motion.p>
    </header>
  );
}
