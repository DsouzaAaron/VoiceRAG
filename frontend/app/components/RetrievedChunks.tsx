"use client";

import { useState } from "react";
import { type SourceChunk } from "@/lib/api";

export default function RetrievedChunks({
  sources,
}: {
  sources: SourceChunk[];
}) {
  const [open, setOpen] = useState(false);

  if (sources.length === 0) return null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-2 text-sm font-medium text-slate-600"
      >
        <span>Sources ({sources.length})</span>
        <span className="text-slate-400">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <ul className="space-y-2 border-t border-slate-100 px-4 py-3">
          {sources.map((s, i) => (
            <li key={i} className="text-xs">
              <p className="font-medium text-slate-500">
                {s.metadata.filename}
                {s.metadata.page != null ? ` — page ${s.metadata.page}` : ""}
              </p>
              <p className="mt-0.5 text-slate-600">{s.text}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
