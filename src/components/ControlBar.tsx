"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import {
  CameraIcon,
  CameraOffIcon,
  CaptionsIcon,
  MicIcon,
  MicOffIcon,
  PhoneOffIcon,
} from "@/components/icons";

export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function ControlBar({
  muted,
  cameraOff,
  captions,
  elapsed,
  remaining,
  disabled,
  onToggleMute,
  onToggleCamera,
  onToggleCaptions,
  onEnd,
}: {
  muted: boolean;
  cameraOff: boolean;
  captions: boolean;
  elapsed: number;
  remaining: number;
  disabled?: boolean;
  onToggleMute: () => void;
  onToggleCamera: () => void;
  onToggleCaptions: () => void;
  onEnd: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const warning = remaining <= 120;

  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 4000);
    return () => clearTimeout(t);
  }, [confirming]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
      role="toolbar"
      aria-label="Interview controls"
      className="glass flex items-center gap-1.5 rounded-full p-1.5 shadow-2xl shadow-black/50 sm:gap-2 sm:p-2"
    >
      <RoundButton label={muted ? "Unmute microphone" : "Mute microphone"} pressed={muted} danger={muted} onClick={onToggleMute} disabled={disabled}>
        {muted ? <MicOffIcon /> : <MicIcon />}
      </RoundButton>
      <RoundButton label={cameraOff ? "Turn camera on" : "Turn camera off"} pressed={cameraOff} danger={cameraOff} onClick={onToggleCamera} disabled={disabled}>
        {cameraOff ? <CameraOffIcon /> : <CameraIcon />}
      </RoundButton>
      <RoundButton label={captions ? "Hide captions" : "Show captions"} pressed={captions} active={captions} onClick={onToggleCaptions} disabled={disabled}>
        <CaptionsIcon />
      </RoundButton>

      <div
        className={`mx-1 flex min-w-[4.5rem] flex-col items-center px-2 font-mono text-sm tabular-nums sm:min-w-[5.5rem] ${warning ? "text-warning" : "text-fg"}`}
        aria-live="off"
      >
        <span aria-label={warning ? `${formatClock(remaining)} remaining` : `Elapsed ${formatClock(elapsed)}`}>
          {warning ? formatClock(remaining) : formatClock(elapsed)}
        </span>
        <span className="text-[10px] tracking-wider text-fg-subtle uppercase">{warning ? "left" : "elapsed"}</span>
      </div>

      <button
        type="button"
        onClick={() => (confirming ? onEnd() : setConfirming(true))}
        disabled={disabled}
        className="flex h-12 items-center gap-2 rounded-full bg-danger px-4 text-sm font-semibold text-ink-950 transition-all hover:brightness-110 active:scale-[0.97] disabled:opacity-50 sm:px-5"
        aria-label={confirming ? "Confirm: end interview" : "End interview"}
      >
        <PhoneOffIcon size={18} />
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={confirming ? "confirm" : "end"}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="hidden sm:inline"
          >
            {confirming ? "Confirm end?" : "End interview"}
          </motion.span>
        </AnimatePresence>
      </button>
    </motion.div>
  );
}

function RoundButton({
  label,
  pressed,
  danger,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  pressed: boolean;
  danger?: boolean;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      className={`flex h-12 w-12 items-center justify-center rounded-full transition-all active:scale-95 disabled:opacity-50 ${
        danger
          ? "bg-danger/20 text-danger hover:bg-danger/30"
          : active
            ? "bg-fg text-ink-950 hover:bg-fg/90"
            : "bg-ink-700/80 text-fg hover:bg-ink-600"
      }`}
    >
      {children}
    </button>
  );
}
