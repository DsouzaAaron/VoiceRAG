"use client";

import { useEffect, useRef, useState } from "react";
import { MicIcon, StopIcon } from "./icons";

type RecorderState = "idle" | "recording" | "processing";

export default function VoiceRecorder({
  state,
  onState,
  onRecorded,
  onStart,
}: {
  state: RecorderState;
  onState: (s: RecorderState) => void;
  onRecorded: (blob: Blob) => void;
  onStart?: () => void;
}) {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);

  function teardownAudio() {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (intervalRef.current != null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setLevel(0);
  }

  useEffect(() => () => teardownAudio(), []);

  async function start() {
    setError(null);
    onStart?.();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "audio/mp4";
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        teardownAudio();
        onRecorded(blob);
      };
      recorder.start();
      recorderRef.current = recorder;

      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new Ctx();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.6;
      source.connect(analyser);
      analyserRef.current = analyser;

      const data = new Uint8Array(analyser.fftSize);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        setLevel(Math.min(1, rms * 3));
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);

      startTimeRef.current = Date.now();
      setElapsedMs(0);
      intervalRef.current = setInterval(() => {
        setElapsedMs(Date.now() - startTimeRef.current);
      }, 100);

      onState("recording");
    } catch (e) {
      setError(`Mic access failed: ${(e as Error).message}`);
    }
  }

  function stop() {
    recorderRef.current?.stop();
    onState("processing");
  }

  const totalSec = Math.floor(elapsedMs / 1000);
  const mm = Math.floor(totalSec / 60);
  const ss = (totalSec % 60).toString().padStart(2, "0");

  const ringScale = 1 + level * 0.6;
  const ringOpacity = 0.18 + level * 0.5;

  const idle = state === "idle";
  const recording = state === "recording";
  const processing = state === "processing";

  const buttonClasses = recording
    ? "bg-gradient-to-br from-red-500 to-rose-600 ring-red-200"
    : processing
      ? "bg-slate-400"
      : "bg-gradient-to-br from-indigo-500 to-violet-600 ring-indigo-200 hover:from-indigo-600 hover:to-violet-700 animate-breathe";

  return (
    <div className="flex flex-col items-center gap-2">
      {/* Pedestal card behind the button */}
      <div className="relative flex h-32 w-32 items-center justify-center">
        {recording && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-full bg-red-500"
            style={{
              transform: `scale(${ringScale})`,
              opacity: ringOpacity,
            }}
          />
        )}
        <button
          onClick={recording ? stop : start}
          disabled={processing}
          aria-label={recording ? "Stop recording" : "Start recording"}
          className={`relative flex h-24 w-24 items-center justify-center rounded-full text-white shadow-xl ring-4 ring-offset-2 ring-offset-white transition-colors disabled:opacity-70 ${buttonClasses}`}
        >
          {recording ? (
            <StopIcon className="h-9 w-9" />
          ) : (
            <MicIcon className="h-9 w-9" />
          )}
        </button>
      </div>

      {recording ? (
        <p className="font-mono text-sm tabular-nums text-slate-600">
          <span className="mr-1.5 inline-block h-2 w-2 animate-pulse rounded-full bg-red-500" />
          {mm}:{ss}
        </p>
      ) : (
        <p className="text-xs text-slate-400">
          {processing
            ? "Transcribing, retrieving, and speaking…"
            : idle
              ? "Click and speak your question"
              : ""}
        </p>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

export type { RecorderState };
