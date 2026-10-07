"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { AlertIcon, CameraIcon, CheckIcon, CloseIcon, MicIcon, ShieldIcon } from "@/components/icons";
import { FOCUSES, LEVELS, type Focus, type Level } from "@/lib/schemas";

export interface InterviewSettings {
  level: Level;
  focus: Focus;
  candidateName?: string;
}

type DeviceState =
  | { kind: "idle" }
  | { kind: "requesting" }
  | { kind: "ready"; stream: MediaStream }
  | { kind: "denied" }
  | { kind: "unavailable"; message: string };

const PRIVACY_KEY = "preproom.privacyAcknowledged";

const noopSubscribe = () => () => {};

/** Requests camera + mic and maps failures to a user-facing state. */
async function acquireMedia(): Promise<DeviceState> {
  if (!navigator.mediaDevices?.getUserMedia) {
    return { kind: "unavailable", message: "This browser can't access a camera. Try the latest Chrome, Edge, Safari or Firefox." };
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: true });
    return { kind: "ready", stream };
  } catch (err) {
    const name = (err as DOMException).name;
    if (name === "NotAllowedError" || name === "SecurityError") return { kind: "denied" };
    if (name === "NotFoundError" || name === "OverconstrainedError")
      return { kind: "unavailable", message: "We couldn't find a camera and microphone. Connect them and try again." };
    if (name === "NotReadableError")
      return { kind: "unavailable", message: "Your camera or microphone is in use by another app. Close it (Zoom, Teams, etc.) and try again." };
    return { kind: "unavailable", message: "We couldn't start your camera. Try again." };
  }
}

function readPrivacyAck(): boolean {
  try {
    return window.localStorage.getItem(PRIVACY_KEY) === "1";
  } catch {
    return false;
  }
}

export function PreflightModal({
  open,
  companyName,
  accent,
  initial,
  onClose,
  onStart,
}: {
  open: boolean;
  companyName: string;
  accent: string;
  initial: InterviewSettings;
  onClose: () => void;
  onStart: (settings: InterviewSettings) => void;
}) {
  // Stored acknowledgement (client only; false during SSR so hydration matches) or one given just now.
  const storedAck = useSyncExternalStore(noopSubscribe, readPrivacyAck, () => false);
  const [ackedNow, setAckedNow] = useState(false);
  const privacyAck = storedAck || ackedNow;
  const [device, setDevice] = useState<DeviceState>({ kind: "idle" });
  const [settings, setSettings] = useState<InterviewSettings>(initial);
  const [level, setLevel] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const titleId = useId();
  const ids = { level: useId(), focus: useId(), name: useId() };

  const stopPreview = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const [deviceRequest, setDeviceRequest] = useState(0);
  const retryDevices = () => {
    setDevice({ kind: "requesting" });
    setDeviceRequest((n) => n + 1);
  };

  // Once privacy is acknowledged, request devices whenever the modal is open.
  useEffect(() => {
    if (!open || !privacyAck) return;
    let cancelled = false;
    acquireMedia().then((next) => {
      if (cancelled) {
        if (next.kind === "ready") next.stream.getTracks().forEach((t) => t.stop());
        return;
      }
      stopPreview();
      if (next.kind === "ready") streamRef.current = next.stream;
      setDevice(next);
    });
    return () => {
      cancelled = true;
      stopPreview();
    };
  }, [open, privacyAck, deviceRequest, stopPreview]);

  // Attach preview + mic level meter.
  useEffect(() => {
    if (device.kind !== "ready") return;
    if (videoRef.current) videoRef.current.srcObject = device.stream;
    let raf = 0;
    let ctx: AudioContext | null = null;
    try {
      ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(device.stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const v of data) sum += ((v - 128) / 128) ** 2;
        setLevel(Math.min(1, Math.sqrt(sum / data.length) * 4));
        raf = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      // Meter is a nicety; ignore if AudioContext is unavailable.
    }
    return () => {
      cancelAnimationFrame(raf);
      void ctx?.close();
    };
  }, [device]);

  // Esc closes; Tab is trapped inside the dialog.
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => dialogRef.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus(), 50);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
      if (e.key !== "Tab" || !dialogRef.current) return;
      const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), select, input, [href], [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      previouslyFocused?.focus?.();
    };
  }, [open, onClose, privacyAck]);

  const acknowledgePrivacy = () => {
    try {
      window.localStorage.setItem(PRIVACY_KEY, "1");
    } catch {
      // Private mode: we'll just ask again next time.
    }
    setAckedNow(true);
  };

  const start = () => {
    stopPreview();
    onStart({ ...settings, candidateName: settings.candidateName?.trim() || undefined });
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-40 flex items-end justify-center bg-ink-950/70 p-0 backdrop-blur-sm sm:items-center sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            style={{ "--accent": accent } as React.CSSProperties}
            className="relative max-h-[100dvh] w-full max-w-3xl overflow-y-auto rounded-t-3xl border border-line bg-ink-900 shadow-2xl shadow-black/60 sm:rounded-3xl"
          >
            <button
              type="button"
              onClick={onClose}
              aria-label="Close setup"
              className="absolute top-4 right-4 z-10 rounded-full p-2 text-fg-subtle transition-colors hover:bg-ink-800 hover:text-fg"
            >
              <CloseIcon size={18} />
            </button>

            {!privacyAck ? (
              <div className="p-7 sm:p-10">
                <span
                  className="flex h-12 w-12 items-center justify-center rounded-2xl border border-line-strong"
                  style={{ color: accent }}
                >
                  <ShieldIcon size={22} />
                </span>
                <h2 id={titleId} className="font-display mt-6 text-3xl text-fg">
                  Before your camera turns on
                </h2>
                <ul className="mt-5 space-y-3 text-fg-muted">
                  <li className="flex gap-3">
                    <CheckIcon size={18} className="mt-0.5 shrink-0 text-success" />
                    Your video and audio are streamed to <strong className="font-medium text-fg">Tavus</strong>, our
                    video AI provider, only for the duration of the interview. We don&apos;t record video.
                  </li>
                  <li className="flex gap-3">
                    <CheckIcon size={18} className="mt-0.5 shrink-0 text-success" />
                    The transcript is scored by an AI model and stored on this PrepRoom server so you can review your
                    feedback.
                  </li>
                  <li className="flex gap-3">
                    <CheckIcon size={18} className="mt-0.5 shrink-0 text-success" />
                    Your interviewer is an AI. It&apos;s a practice tool and isn&apos;t affiliated with {companyName}.
                  </li>
                </ul>
                <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-full border border-line px-5 py-3 text-sm text-fg-muted hover:border-line-strong hover:text-fg"
                  >
                    Not now
                  </button>
                  <button
                    type="button"
                    data-autofocus
                    onClick={acknowledgePrivacy}
                    className="rounded-full px-6 py-3 text-sm font-semibold text-ink-950 transition-transform hover:scale-[1.02] active:scale-[0.98]"
                    style={{ background: accent }}
                  >
                    I understand, check my camera
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid gap-0 md:grid-cols-[1.15fr_1fr]">
                {/* Preview */}
                <div className="relative bg-ink-950 md:rounded-l-3xl">
                  <div className="relative aspect-video w-full overflow-hidden md:aspect-auto md:h-full md:min-h-[440px] md:rounded-l-3xl">
                    {device.kind === "ready" ? (
                      <video ref={videoRef} autoPlay playsInline muted className="mirror h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full min-h-[220px] flex-col items-center justify-center gap-3 p-6 text-center">
                        {device.kind === "requesting" || device.kind === "idle" ? (
                          <>
                            <span className="h-10 w-10 animate-spin rounded-full border-2 border-line-strong border-t-[color:var(--accent)] motion-reduce:animate-none" />
                            <p className="text-sm text-fg-muted">Waiting for camera permission…</p>
                          </>
                        ) : (
                          <>
                            <AlertIcon size={28} className="text-warning" />
                            <p className="max-w-xs text-sm text-fg-muted">
                              {device.kind === "denied"
                                ? "Camera and microphone access was blocked. Click the camera icon in your browser's address bar, allow access, then try again."
                                : device.message}
                            </p>
                            <button
                              type="button"
                              onClick={retryDevices}
                              className="mt-1 rounded-full border border-line-strong px-4 py-2 text-sm text-fg hover:bg-ink-800"
                            >
                              Try again
                            </button>
                          </>
                        )}
                      </div>
                    )}
                    {device.kind === "ready" && (
                      <div className="glass absolute bottom-3 left-3 flex items-center gap-2 rounded-full px-3 py-1.5 text-xs text-fg">
                        <MicIcon size={14} />
                        <span className="flex h-2 w-16 overflow-hidden rounded-full bg-ink-700" aria-label="Microphone level">
                          <span
                            className="h-full rounded-full transition-[width] duration-75"
                            style={{ width: `${Math.round(level * 100)}%`, background: accent }}
                          />
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Settings */}
                <div className="flex flex-col p-6 sm:p-8">
                  <h2 id={titleId} className="font-display pr-8 text-3xl leading-tight text-fg">
                    Ready for {companyName}?
                  </h2>
                  <ul className="mt-4 space-y-1.5 text-sm text-fg-muted">
                    <li>· Quiet room, face lit from the front, camera at eye level.</li>
                    <li>· Headphones help the interviewer hear you cleanly.</li>
                    <li>· Answer out loud as you would in the real room. You can be interrupted.</li>
                    <li>· About 15–20 minutes. Feedback arrives right after.</li>
                  </ul>

                  <div className="mt-6 grid gap-4 sm:grid-cols-2 md:grid-cols-1 lg:grid-cols-2">
                    <Field id={ids.level} label="Role / level">
                      <select
                        id={ids.level}
                        data-autofocus
                        value={settings.level}
                        onChange={(e) => setSettings((s) => ({ ...s, level: e.target.value as Level }))}
                        className="w-full rounded-xl border border-line bg-ink-850 px-3 py-2.5 text-fg focus:border-line-strong"
                      >
                        {LEVELS.map((l) => (
                          <option key={l}>{l}</option>
                        ))}
                      </select>
                    </Field>
                    <Field id={ids.focus} label="Interview focus">
                      <select
                        id={ids.focus}
                        value={settings.focus}
                        onChange={(e) => setSettings((s) => ({ ...s, focus: e.target.value as Focus }))}
                        className="w-full rounded-xl border border-line bg-ink-850 px-3 py-2.5 text-fg focus:border-line-strong"
                      >
                        {FOCUSES.map((f) => (
                          <option key={f}>{f}</option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <div className="mt-4">
                    <Field id={ids.name} label="Your first name (optional)">
                      <input
                        id={ids.name}
                        type="text"
                        maxLength={60}
                        autoComplete="given-name"
                        value={settings.candidateName ?? ""}
                        onChange={(e) => setSettings((s) => ({ ...s, candidateName: e.target.value }))}
                        placeholder="So the interviewer can greet you"
                        className="w-full rounded-xl border border-line bg-ink-850 px-3 py-2.5 text-fg placeholder:text-fg-subtle focus:border-line-strong"
                      />
                    </Field>
                  </div>

                  <button
                    type="button"
                    onClick={start}
                    disabled={device.kind !== "ready"}
                    className="mt-8 flex items-center justify-center gap-2 rounded-full px-6 py-4 text-base font-semibold text-ink-950 transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100"
                    style={{ background: accent }}
                  >
                    <CameraIcon size={20} />
                    Start interview
                  </button>
                  {device.kind !== "ready" && (
                    <p className="mt-2 text-center text-xs text-fg-subtle">Allow camera and microphone to start.</p>
                  )}
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-xs font-medium tracking-wide text-fg-subtle uppercase">
        {label}
      </label>
      {children}
    </div>
  );
}
