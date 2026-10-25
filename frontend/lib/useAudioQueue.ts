"use client";

import { useCallback, useEffect, useRef } from "react";

function base64ToWavUrl(base64: string): string {
  const bytes = atob(base64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  const blob = new Blob([arr], { type: "audio/wav" });
  return URL.createObjectURL(blob);
}

// A short, truly-silent WAV used only to unlock autoplay within a user gesture.
function silentWavUrl(): string {
  const sampleRate = 8000;
  const numSamples = 400; // ~50ms
  const dataSize = numSamples; // 8-bit mono
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true); // byte rate (blockAlign=1)
  view.setUint16(32, 1, true); // block align
  view.setUint16(34, 8, true); // bits per sample
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);
  for (let i = 0; i < numSamples; i++) view.setUint8(44 + i, 128); // 8-bit silence
  return URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
}

/**
 * Plays WAV clips (base64) back-to-back in arrival order using a single
 * <audio> element. `prime()` must be called from a user gesture (the mic
 * click) so the browser allows the later autoplay.
 */
export function useAudioQueue() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<string[]>([]);
  const playingRef = useRef(false);

  const revoke = (url?: string | null) => {
    if (url && url.startsWith("blob:")) URL.revokeObjectURL(url);
  };

  const playNext = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const next = queueRef.current.shift();
    if (!next) {
      playingRef.current = false;
      return;
    }
    revoke(audio.src); // discard the finished/silent clip currently loaded
    playingRef.current = true;
    audio.src = next;
    audio.play().catch(() => {
      playingRef.current = false;
    });
  }, []);

  useEffect(() => {
    const audio = new Audio();
    audioRef.current = audio;
    const onEnded = () => playNext();
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("ended", onEnded);
      audio.pause();
      revoke(audio.src);
      queueRef.current.forEach(revoke);
      queueRef.current = [];
    };
  }, [playNext]);

  const reset = useCallback(() => {
    const audio = audioRef.current;
    queueRef.current.forEach(revoke);
    queueRef.current = [];
    playingRef.current = false;
    if (audio) {
      audio.pause();
      revoke(audio.src);
      audio.removeAttribute("src");
      audio.load(); // flush the loaded resource so it can't be replayed
    }
  }, []);

  const prime = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    // Unlock autoplay with a fresh silent clip — never resurrect old audio.
    audio.src = silentWavUrl();
    audio.play().catch(() => {});
  }, []);

  const enqueue = useCallback(
    (base64: string) => {
      queueRef.current.push(base64ToWavUrl(base64));
      if (!playingRef.current) playNext();
    },
    [playNext]
  );

  return { prime, enqueue, reset };
}
