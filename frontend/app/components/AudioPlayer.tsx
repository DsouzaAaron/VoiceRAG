"use client";

import { useEffect, useRef } from "react";

export default function AudioPlayer({ base64 }: { base64: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!base64) return;
    const bytes = atob(base64);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    const blob = new Blob([arr], { type: "audio/wav" });
    const url = URL.createObjectURL(blob);
    if (audioRef.current) {
      audioRef.current.src = url;
      audioRef.current.play().catch(() => {
        /* autoplay may be blocked; user can press play */
      });
    }
    return () => URL.revokeObjectURL(url);
  }, [base64]);

  return <audio ref={audioRef} controls className="mt-2 w-full" />;
}
