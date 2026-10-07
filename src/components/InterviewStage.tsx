"use client";

import type {
  DailyCall,
  DailyEventObjectAppMessage,
  DailyEventObjectFatalError,
  DailyEventObjectParticipantLeft,
  DailyEventObjectTrack,
} from "@daily-co/daily-js";
import { AnimatePresence, motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Monogram } from "@/components/CompanyCard";
import { ControlBar, formatClock } from "@/components/ControlBar";
import { AlertIcon, CameraOffIcon, RefreshIcon } from "@/components/icons";
import type { InterviewSettings } from "@/components/PreflightModal";
import { useToast } from "@/components/Toast";
import { ApiErrorSchema, StartInterviewResponseSchema } from "@/lib/schemas";
import { stripEmotionTags } from "@/lib/speech";

type Phase = "starting" | "joining" | "waiting" | "live" | "ending" | "error";
type EndReason = "user" | "timeout" | "interviewer_left" | "tab_closed" | "error";

interface StageError {
  kind: "permissions" | "api" | "timeout" | "connection";
  title: string;
  message: string;
  retryable: boolean;
}

/** How long we wait for the interviewer's video before giving up. */
const CONNECT_TIMEOUT_MS = 75_000;

export interface StageCompany {
  name: string;
  slug: string;
  industry: string;
  accent: string;
  monogram?: string;
}

function sendEndBeacon(conversationId: string, reason: EndReason) {
  const body = JSON.stringify({ conversationId, reason });
  try {
    if (navigator.sendBeacon?.(`/api/interview/end`, new Blob([body], { type: "application/json" }))) return;
  } catch {
    // fall through to keepalive fetch
  }
  void fetch("/api/interview/end", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => undefined);
}

export function InterviewStage({
  company,
  settings,
  onExit,
}: {
  company: StageCompany;
  settings: InterviewSettings;
  /** Return to the setup screen (after an error or cancel). */
  onExit: () => void;
}) {
  const router = useRouter();
  const toast = useToast();

  const [phase, setPhaseState] = useState<Phase>("starting");
  const [error, setError] = useState<StageError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [captionsOn, setCaptionsOn] = useState(true);
  const [caption, setCaption] = useState<{ text: string; key: number } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [remaining, setRemaining] = useState(Infinity);
  const [interviewerName, setInterviewerName] = useState<string | undefined>();
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [hasLocalVideo, setHasLocalVideo] = useState(false);

  const phaseRef = useRef<Phase>("starting");
  const callRef = useRef<DailyCall | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const endedRef = useRef(false);
  const createdAtRef = useRef<number>(0);
  const liveAtRef = useRef<number | null>(null);
  const maxDurationRef = useRef<number>(1200);
  const connectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAttemptRef = useRef<number | null>(null);
  const unmountedRef = useRef(false);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);

  const setPhase = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhaseState(p);
  }, []);

  const teardownCall = useCallback(async () => {
    if (connectTimerRef.current) clearTimeout(connectTimerRef.current);
    const call = callRef.current;
    callRef.current = null;
    if (!call) return;
    try {
      await call.leave();
    } catch {
      // already left
    }
    try {
      await call.destroy();
    } catch {
      // already destroyed
    }
  }, []);

  const fail = useCallback(
    async (err: StageError) => {
      await teardownCall();
      setError(err);
      setPhase("error");
    },
    [setPhase, teardownCall],
  );

  /* ---------------- end ---------------- */

  const endInterview = useCallback(
    async (reason: EndReason) => {
      const id = conversationIdRef.current;
      if (endedRef.current || !id) return;
      endedRef.current = true;
      setPhase("ending");
      await teardownCall();
      try {
        const res = await fetch("/api/interview/end", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ conversationId: id, reason }),
          keepalive: true,
        });
        if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
      } catch {
        toast.error("We couldn't confirm the call ended", "Your feedback will still be generated. If it doesn't appear, retry from the results page.");
      }
      router.push(`/results/${encodeURIComponent(id)}`);
    },
    [router, setPhase, teardownCall, toast],
  );
  const endRef = useRef(endInterview);
  useEffect(() => {
    endRef.current = endInterview;
  }, [endInterview]);

  /* ---------------- start + join ---------------- */

  const run = useCallback(async () => {
    setPhase("starting");
    setError(null);
    setCaption(null);
    setElapsed(0);
    setRemaining(Infinity);
    liveAtRef.current = null;
    endedRef.current = false;

    // 1. Ask our server to provision + create the Tavus conversation.
    let data;
    try {
      const res = await fetch("/api/interview/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          industry: company.industry,
          company: company.slug,
          level: settings.level,
          focus: settings.focus,
          candidateName: settings.candidateName,
          cvText: settings.cvText,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        const parsed = ApiErrorSchema.safeParse(json);
        const message = parsed.success ? parsed.data.error.message : "We couldn't start the interview. Please try again.";
        toast.error("Couldn't start the interview", message);
        await fail({ kind: "api", title: "We couldn't start your interview", message, retryable: parsed.success ? parsed.data.error.retryable : true });
        return;
      }
      data = StartInterviewResponseSchema.parse(json);
    } catch {
      await fail({ kind: "api", title: "We couldn't reach PrepRoom", message: "Check your internet connection and try again.", retryable: true });
      return;
    }

    conversationIdRef.current = data.conversationId;
    createdAtRef.current = Date.now();
    maxDurationRef.current = data.maxDurationSeconds;
    setInterviewerName(data.interviewerName);
    if (unmountedRef.current) {
      sendEndBeacon(data.conversationId, "tab_closed");
      return;
    }

    // 2. Join the Daily room in call-object mode and render tracks ourselves.
    setPhase("joining");
    let call: DailyCall;
    try {
      const Daily = (await import("@daily-co/daily-js")).default;
      call = Daily.createCallObject({ subscribeToTracksAutomatically: true });
    } catch {
      await fail({ kind: "connection", title: "Video couldn't load", message: "Your browser blocked the video call library. Disable strict content blockers for this site and retry.", retryable: true });
      return;
    }
    callRef.current = call;

    call.on("track-started", (e?: DailyEventObjectTrack) => {
      if (!e?.track) return;
      if (e.participant?.local) {
        if (e.type === "video" && localVideoRef.current) {
          localVideoRef.current.srcObject = new MediaStream([e.track]);
          setHasLocalVideo(true);
        }
        return;
      }
      if (e.type === "video" && remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = new MediaStream([e.track]);
        void remoteVideoRef.current.play().catch(() => undefined);
        if (connectTimerRef.current) clearTimeout(connectTimerRef.current);
        if (!liveAtRef.current) liveAtRef.current = Date.now();
        setPhase("live");
      }
      if (e.type === "audio" && remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = new MediaStream([e.track]);
        remoteAudioRef.current.play().then(
          () => setAudioBlocked(false),
          () => setAudioBlocked(true),
        );
      }
    });
    call.on("track-stopped", (e?: DailyEventObjectTrack) => {
      if (e?.participant?.local && e.type === "video") setHasLocalVideo(false);
    });
    call.on("participant-left", (e?: DailyEventObjectParticipantLeft) => {
      // The interviewer leaving means Tavus ended the conversation (wrap-up, max duration, error).
      if (e && !e.participant.local && phaseRef.current === "live") void endRef.current("interviewer_left");
    });
    call.on("left-meeting", () => {
      if (!endedRef.current && phaseRef.current === "live") void endRef.current("interviewer_left");
    });
    call.on("app-message", (e?: DailyEventObjectAppMessage) => {
      const d = e?.data as { event_type?: string; properties?: { role?: string; speech?: string } } | undefined;
      if (d?.event_type === "conversation.utterance" && d.properties?.role === "pal" && d.properties.speech) {
        const text = stripEmotionTags(d.properties.speech);
        if (text) setCaption({ text, key: Date.now() });
      }
    });
    call.on("camera-error", () => {
      toast.error("Camera problem", "We lost access to your camera or microphone. Check your browser permissions.");
    });
    call.on("error", (e?: DailyEventObjectFatalError) => {
      void fail({
        kind: "connection",
        title: "The video connection dropped",
        message: e?.errorMsg ? `Details: ${e.errorMsg}` : "Check your connection and retry.",
        retryable: true,
      });
    });

    try {
      await call.join({ url: data.conversationUrl });
    } catch (err) {
      const msg = String((err as Error)?.message ?? err);
      const permission = /permission|notallowed|denied/i.test(msg);
      await fail(
        permission
          ? { kind: "permissions", title: "Camera or microphone blocked", message: "Allow camera and microphone access in your browser's address bar, then retry.", retryable: true }
          : { kind: "connection", title: "We couldn't join the video room", message: "Check your connection or firewall (video calls use WebRTC) and retry.", retryable: true },
      );
      return;
    }
    if (phaseRef.current === "joining") setPhase("waiting");
    connectTimerRef.current = setTimeout(() => {
      if (phaseRef.current === "waiting" || phaseRef.current === "joining") {
        void fail({
          kind: "timeout",
          title: "The interviewer didn't connect",
          message: "This is usually temporary on the video service's side. Retry in a moment.",
          retryable: true,
        });
      }
    }, CONNECT_TIMEOUT_MS);
  }, [company.industry, company.slug, fail, setPhase, settings, toast]);

  // Run once per attempt (guarded so React StrictMode's double-invoke can't create two conversations).
  useEffect(() => {
    if (startedAttemptRef.current === attempt) return;
    startedAttemptRef.current = attempt;
    void run();
  }, [attempt, run]);

  // Lifecycle: lock scroll, end on tab close, clean up on unmount.
  useEffect(() => {
    unmountedRef.current = false;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onPageHide = () => {
      const id = conversationIdRef.current;
      if (id && !endedRef.current) {
        endedRef.current = true;
        sendEndBeacon(id, "tab_closed");
      }
    };
    window.addEventListener("pagehide", onPageHide);
    return () => {
      unmountedRef.current = true;
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("pagehide", onPageHide);
      onPageHide();
      void teardownCall();
    };
  }, [teardownCall]);

  // Clock: elapsed since the interviewer appeared; remaining against Tavus' max duration.
  useEffect(() => {
    if (phase !== "live") return;
    const tick = () => {
      const now = Date.now();
      setElapsed((now - (liveAtRef.current ?? now)) / 1000);
      const left = maxDurationRef.current - (now - createdAtRef.current) / 1000;
      setRemaining(left);
      if (left <= 0) void endRef.current("timeout");
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [phase]);

  // Captions fade after a while.
  useEffect(() => {
    if (!caption) return;
    const t = setTimeout(() => setCaption(null), Math.min(14_000, 4000 + caption.text.length * 60));
    return () => clearTimeout(t);
  }, [caption]);

  const retry = async () => {
    const id = conversationIdRef.current;
    if (id && !endedRef.current) {
      endedRef.current = true;
      sendEndBeacon(id, "error");
    }
    conversationIdRef.current = null;
    await teardownCall();
    setAttempt((a) => a + 1);
  };

  const backToSetup = async () => {
    const id = conversationIdRef.current;
    if (id && !endedRef.current) {
      endedRef.current = true;
      sendEndBeacon(id, "error");
    }
    conversationIdRef.current = null;
    await teardownCall();
    onExit();
  };

  const toggleMute = () => {
    const next = !muted;
    callRef.current?.setLocalAudio(!next);
    setMuted(next);
  };
  const toggleCamera = () => {
    const next = !cameraOff;
    callRef.current?.setLocalVideo(!next);
    setCameraOff(next);
  };

  const connecting = phase === "starting" || phase === "joining" || phase === "waiting";
  const showCountdown = phase === "live" && remaining <= 120;

  return (
    <motion.div
      className="fixed inset-0 z-50 h-[100dvh] w-screen overflow-hidden bg-ink-950"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      style={{ "--accent": company.accent } as React.CSSProperties}
    >
      <h1 className="sr-only">
        Interview with {company.name}
        {interviewerName ? `, ${interviewerName}` : ""}
      </h1>

      {/* Interviewer video */}
      <motion.video
        ref={remoteVideoRef}
        autoPlay
        playsInline
        className="absolute inset-0 h-full w-full object-cover"
        initial={{ opacity: 0, scale: 1.03 }}
        animate={{ opacity: phase === "live" || phase === "ending" ? 1 : 0, scale: phase === "live" ? 1 : 1.03 }}
        transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
        aria-label={`Video of your interviewer${interviewerName ? `, ${interviewerName}` : ""}`}
      />
      <audio ref={remoteAudioRef} autoPlay />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-black/70 to-transparent" />

      {/* Connecting state */}
      <AnimatePresence>
        {connecting && (
          <motion.div
            key="connecting"
            className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.6 } }}
            role="status"
            aria-live="polite"
          >
            <motion.div
              animate={{ scale: [1, 1.06, 1] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
              className="relative"
            >
              <span aria-hidden className="absolute inset-0 -m-6 rounded-full opacity-30 blur-2xl" style={{ background: company.accent }} />
              <Monogram name={company.name} label={company.monogram} accent={company.accent} size="lg" />
            </motion.div>
            <p className="font-display mt-8 text-3xl text-fg sm:text-4xl">
              {phase === "starting" ? "Preparing your interviewer" : phase === "joining" ? "Joining the room" : `${interviewerName ?? "Your interviewer"} is joining`}
            </p>
            <p className="mt-3 max-w-md text-fg-muted">
              {phase === "starting"
                ? `Setting up the ${company.name} interview. The first session for a firm can take a little longer.`
                : "Take a breath, sit up straight, and look at the camera."}
            </p>
            <ol className="mt-8 flex items-center gap-3" aria-label="Connection progress">
              {(["starting", "joining", "waiting"] as const).map((step, i) => {
                const order = ["starting", "joining", "waiting"].indexOf(phase);
                return (
                  <li
                    key={step}
                    className="h-1.5 w-10 rounded-full transition-colors duration-500"
                    style={{ background: i <= order ? company.accent : "var(--color-ink-700)" }}
                    aria-current={i === order ? "step" : undefined}
                  >
                    <span className="sr-only">{["Preparing", "Joining", "Waiting for interviewer"][i]}</span>
                  </li>
                );
              })}
            </ol>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Countdown banner (last 2 minutes) */}
      <AnimatePresence>
        {showCountdown && (
          <motion.div
            key="countdown"
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            className="glass absolute top-5 left-1/2 -translate-x-1/2 rounded-full px-4 py-2 text-sm text-warning"
            role="timer"
            aria-live="polite"
          >
            <span className="font-mono tabular-nums">{formatClock(remaining)}</span>
            <span className="text-fg-muted"> remaining · the interview will close automatically</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Self view */}
      {phase !== "error" && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.3 }}
          className="absolute right-4 bottom-28 aspect-video w-36 overflow-hidden rounded-2xl border border-line-strong bg-ink-850 shadow-xl sm:right-6 sm:bottom-6 sm:w-56"
        >
          <video ref={localVideoRef} autoPlay playsInline muted className={`mirror h-full w-full object-cover ${cameraOff || !hasLocalVideo ? "invisible" : ""}`} aria-label="Your camera preview" />
          {(cameraOff || !hasLocalVideo) && (
            <div className="absolute inset-0 flex items-center justify-center text-fg-subtle">
              <CameraOffIcon size={22} />
            </div>
          )}
        </motion.div>
      )}

      {/* Captions */}
      <div className="pointer-events-none absolute inset-x-0 bottom-28 flex justify-center px-4 sm:bottom-32" aria-live="polite">
        <AnimatePresence mode="wait">
          {captionsOn && caption && phase === "live" && (
            <motion.p
              key={caption.key}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="max-w-3xl rounded-2xl bg-black/70 px-5 py-3 text-center text-base leading-relaxed text-white sm:text-lg"
            >
              {caption.text}
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      {audioBlocked && phase === "live" && (
        <button
          type="button"
          onClick={() => remoteAudioRef.current?.play().then(() => setAudioBlocked(false), () => undefined)}
          className="glass absolute top-5 left-5 rounded-full px-4 py-2 text-sm text-fg"
        >
          Click to enable interviewer audio
        </button>
      )}

      {/* Control bar */}
      {phase !== "error" && (
        <div className="absolute inset-x-0 bottom-5 flex justify-center px-3 sm:bottom-8">
          <ControlBar
            muted={muted}
            cameraOff={cameraOff}
            captions={captionsOn}
            elapsed={elapsed}
            remaining={remaining}
            disabled={phase === "ending" || phase === "starting"}
            onToggleMute={toggleMute}
            onToggleCamera={toggleCamera}
            onToggleCaptions={() => setCaptionsOn((c) => !c)}
            onEnd={() => (conversationIdRef.current ? void endInterview("user") : void backToSetup())}
          />
        </div>
      )}

      {/* Ending */}
      <AnimatePresence>
        {phase === "ending" && (
          <motion.div
            key="ending"
            className="absolute inset-0 flex flex-col items-center justify-center bg-ink-950/85 text-center backdrop-blur-md"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            role="status"
            aria-live="assertive"
          >
            <span className="h-10 w-10 animate-spin rounded-full border-2 border-line-strong border-t-[color:var(--accent)] motion-reduce:animate-none" />
            <p className="font-display mt-6 text-3xl text-fg">Interview complete</p>
            <p className="mt-2 text-fg-muted">Wrapping up…</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error */}
      {phase === "error" && error && (
        <div className="absolute inset-0 flex items-center justify-center bg-ink-950 px-6">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            role="alertdialog"
            aria-labelledby="stage-error-title"
            aria-describedby="stage-error-message"
            className="w-full max-w-md rounded-3xl border border-line bg-ink-900 p-8 text-center"
          >
            <AlertIcon size={32} className="mx-auto text-warning" />
            <h2 id="stage-error-title" className="font-display mt-4 text-3xl text-fg">
              {error.title}
            </h2>
            <p id="stage-error-message" className="mt-3 text-fg-muted">
              {error.message}
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
              <button
                type="button"
                onClick={backToSetup}
                className="rounded-full border border-line px-5 py-3 text-sm text-fg-muted hover:border-line-strong hover:text-fg"
              >
                Back to setup
              </button>
              {error.retryable && (
                <button
                  type="button"
                  autoFocus
                  onClick={retry}
                  className="flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold text-ink-950"
                  style={{ background: company.accent }}
                >
                  <RefreshIcon size={16} /> Retry
                </button>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </motion.div>
  );
}
