"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { AlertIcon, CameraIcon, CheckIcon, CloseIcon, MicIcon, ShieldIcon } from "@/components/icons";
import { ApiErrorSchema, CvExtractResponseSchema, FOCUSES, type Focus, type Level } from "@/lib/schemas";

export interface InterviewSettings {
  level: Level;
  focus: Focus;
  candidateName?: string;
  /** Text extracted from the candidate's CV (kept in the browser until the interview starts). */
  cvText?: string;
  cvFileName?: string;
}

/** Firm-specific setup options, resolved on the server. */
export interface SetupOptions {
  levels: Level[];
  interviewMinutes: number;
  inCallDebrief: boolean;
  cvUpload: boolean;
  /** A written scorecard follows the call (false while scoring is disabled). */
  writtenScorecard: boolean;
}

const FOCUS_LABELS: Record<Focus, string> = {
  Mixed: "Full interview",
  Behavioral: "Fit & behavioral",
  Technical: "Case / technical",
};

type CvState =
  | { kind: "none" }
  | { kind: "uploading"; name: string }
  | { kind: "attached"; name: string; pages: number; truncated: boolean }
  | { kind: "error"; message: string };

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
  setup,
  onClose,
  onStart,
}: {
  open: boolean;
  companyName: string;
  accent: string;
  initial: InterviewSettings;
  setup: SetupOptions;
  onClose: () => void;
  onStart: (settings: InterviewSettings) => void;
}) {
  // Stored acknowledgement (client only; false during SSR so hydration matches) or one given just now.
  const storedAck = useSyncExternalStore(noopSubscribe, readPrivacyAck, () => false);
  const [ackedNow, setAckedNow] = useState(false);
  const privacyAck = storedAck || ackedNow;
  const [device, setDevice] = useState<DeviceState>({ kind: "idle" });
  const [settings, setSettings] = useState<InterviewSettings>(initial);
  const [cv, setCv] = useState<CvState>(
    initial.cvText && initial.cvFileName ? { kind: "attached", name: initial.cvFileName, pages: 0, truncated: false } : { kind: "none" },
  );
  const cvInputRef = useRef<HTMLInputElement>(null);
  const [level, setLevel] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const titleId = useId();
  const ids = { level: useId(), focus: useId(), name: useId(), cv: useId() };

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

  const uploadCv = async (file: File) => {
    setCv({ kind: "uploading", name: file.name });
    setSettings((s) => ({ ...s, cvText: undefined, cvFileName: undefined }));
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/cv", { method: "POST", body });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        const err = ApiErrorSchema.safeParse(json);
        setCv({ kind: "error", message: err.success ? err.data.error.message : "We couldn't read that file." });
        return;
      }
      const data = CvExtractResponseSchema.parse(json);
      setSettings((s) => ({ ...s, cvText: data.text, cvFileName: data.fileName }));
      setCv({ kind: "attached", name: data.fileName, pages: data.pages, truncated: data.truncated });
    } catch {
      setCv({ kind: "error", message: "Upload failed. Check your connection and try again." });
    } finally {
      if (cvInputRef.current) cvInputRef.current.value = "";
    }
  };

  const removeCv = () => {
    setCv({ kind: "none" });
    setSettings((s) => ({ ...s, cvText: undefined, cvFileName: undefined }));
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
                    {setup.writtenScorecard
                      ? "The transcript is scored by an AI model and stored on this PrepRoom server so you can review your feedback."
                      : "The transcript is stored on this PrepRoom server so you can review it after the call."}
                  </li>
                  {setup.cvUpload && (
                    <li className="flex gap-3">
                      <CheckIcon size={18} className="mt-0.5 shrink-0 text-success" />
                      If you attach a CV, its text is shared with the interviewer for this session only. PrepRoom
                      doesn&apos;t store it.
                    </li>
                  )}
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
                    <li>
                      · About {setup.interviewMinutes} minutes.{" "}
                      {setup.inCallDebrief
                        ? setup.writtenScorecard
                          ? "Your interviewer debriefs you at the end, and a written scorecard follows."
                          : "Your interviewer debriefs you out loud at the end."
                        : setup.writtenScorecard
                          ? "Feedback arrives right after."
                          : "The transcript is available right after."}
                    </li>
                    {setup.inCallDebrief && <li>· Say &ldquo;timeout&rdquo; for quick feedback or &ldquo;auf Deutsch&rdquo; to switch language.</li>}
                  </ul>

                  <div className="mt-6 grid gap-4 sm:grid-cols-2 md:grid-cols-1">
                    <Field id={ids.level} label="Role / level">
                      <select
                        id={ids.level}
                        data-autofocus
                        value={settings.level}
                        onChange={(e) => setSettings((s) => ({ ...s, level: e.target.value as Level }))}
                        className="w-full rounded-xl border border-line bg-ink-850 px-3 py-2.5 text-fg focus:border-line-strong"
                      >
                        {setup.levels.map((l) => (
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
                          <option key={f} value={f}>
                            {FOCUS_LABELS[f]}
                          </option>
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
                  {setup.cvUpload && (
                    <div className="mt-4">
                      <span className="mb-1.5 block text-xs font-medium tracking-wide text-fg-subtle uppercase">
                        Your CV (optional)
                      </span>
                      <input
                        ref={cvInputRef}
                        id={ids.cv}
                        type="file"
                        accept=".pdf,.txt,application/pdf,text/plain"
                        className="sr-only"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void uploadCv(f);
                        }}
                      />
                      {cv.kind === "attached" ? (
                        <div className="flex items-center gap-3 rounded-xl border border-line bg-ink-850 px-3 py-2.5 text-sm">
                          <CheckIcon size={16} className="shrink-0 text-success" />
                          <span className="min-w-0 flex-1 truncate text-fg" title={cv.name}>
                            {cv.name}
                            {cv.truncated && <span className="text-fg-subtle"> (first part used)</span>}
                          </span>
                          <button type="button" onClick={removeCv} className="text-fg-subtle hover:text-fg">
                            Remove
                          </button>
                        </div>
                      ) : (
                        <label
                          htmlFor={ids.cv}
                          className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-dashed border-line-strong bg-ink-850/60 px-3 py-2.5 text-sm text-fg-muted hover:text-fg focus-within:outline-2"
                          aria-busy={cv.kind === "uploading"}
                        >
                          <span className="truncate">
                            {cv.kind === "uploading" ? `Reading ${cv.name}…` : "Attach a PDF so questions match your background"}
                          </span>
                          <span className="shrink-0 text-xs text-fg-subtle">{cv.kind === "uploading" ? "" : "Browse"}</span>
                        </label>
                      )}
                      {cv.kind === "error" && (
                        <p role="alert" className="mt-1.5 text-xs text-danger">
                          {cv.message}
                        </p>
                      )}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={start}
                    disabled={device.kind !== "ready" || cv.kind === "uploading"}
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
