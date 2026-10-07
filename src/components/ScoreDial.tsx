"use client";

import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "framer-motion";
import { useEffect, useState } from "react";
import type { HireSignal } from "@/lib/schemas";

const SIGNAL_COLORS: Record<HireSignal, string> = {
  "Strong No Hire": "#f26d6d",
  "No Hire": "#f2996d",
  "Lean Hire": "#f2c46d",
  Hire: "#7fd99a",
  "Strong Hire": "#4fd1a5",
};

export function signalColor(signal: HireSignal): string {
  return SIGNAL_COLORS[signal];
}

const SIZE = 240;
const STROKE = 14;
const R = (SIZE - STROKE) / 2;
const CIRC = 2 * Math.PI * R;
// 270° gauge, open at the bottom.
const ARC = CIRC * 0.75;

export function ScoreDial({ score, signal }: { score: number; signal: HireSignal }) {
  const reduce = useReducedMotion();
  const value = useMotionValue(reduce ? score : 0);
  const dash = useTransform(value, (v) => `${(v / 10) * ARC} ${CIRC}`);
  const [display, setDisplay] = useState(reduce ? score.toFixed(1) : "0.0");
  const color = SIGNAL_COLORS[signal];

  useEffect(() => {
    if (reduce) {
      value.set(score);
      return;
    }
    const controls = animate(value, score, {
      duration: 1.6,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setDisplay(v.toFixed(1)),
    });
    return () => controls.stop();
  }, [score, reduce, value]);

  return (
    <div className="relative mx-auto" style={{ width: SIZE, height: SIZE }} role="img" aria-label={`Overall score ${score.toFixed(1)} out of 10, ${signal}`}>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="rotate-[135deg]" aria-hidden>
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          fill="none"
          stroke="var(--color-ink-700)"
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={`${ARC} ${CIRC}`}
        />
        <motion.circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          fill="none"
          stroke={color}
          strokeWidth={STROKE}
          strokeLinecap="round"
          style={{ strokeDasharray: dash, filter: `drop-shadow(0 0 12px ${color}55)` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center" aria-hidden>
        <span className="font-display text-7xl leading-none text-fg tabular-nums">{reduce ? score.toFixed(1) : display}</span>
        <span className="mt-1 text-sm text-fg-subtle">out of 10</span>
      </div>
    </div>
  );
}
