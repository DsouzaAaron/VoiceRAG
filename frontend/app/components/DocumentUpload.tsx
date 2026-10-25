"use client";

import { useRef, useState } from "react";
import { api } from "@/lib/api";
import { PlusIcon } from "./icons";

const ACCEPT = ".pdf,.docx,.txt";

export default function DocumentUpload({
  chatId,
  onUploaded,
  compact = false,
}: {
  chatId: string;
  onUploaded: () => void;
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleFile(file: File) {
    setBusy(true);
    setStatus(`Parsing & embedding "${file.name}"…`);
    try {
      const res = await api.ingestDocument(file, chatId);
      setStatus(`Added ${res.filename} (${res.chunk_count} chunks)`);
      onUploaded();
    } catch (e) {
      setStatus(`Error: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      accept={ACCEPT}
      className="hidden"
      onChange={(e) => {
        const file = e.target.files?.[0];
        if (file) handleFile(file);
        e.target.value = "";
      }}
    />
  );

  if (compact) {
    return (
      <>
        <button
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition hover:border-indigo-300 hover:text-indigo-600 disabled:opacity-60"
        >
          <PlusIcon className="h-3.5 w-3.5" />
          {busy ? "Adding…" : "Add document"}
        </button>
        {fileInput}
        {status && busy && (
          <span className="ml-2 text-xs text-slate-400">{status}</span>
        )}
      </>
    );
  }

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) handleFile(file);
        }}
        onClick={() => inputRef.current?.click()}
        className={`cursor-pointer rounded-lg border-2 border-dashed px-4 py-3 text-center transition ${
          dragging
            ? "border-indigo-500 bg-indigo-50"
            : "border-slate-200 bg-slate-50/50 hover:border-slate-300 hover:bg-white"
        } ${busy ? "pointer-events-none opacity-60" : ""}`}
      >
        <p className="text-sm font-medium text-slate-600">
          Drop a file or click to upload
        </p>
        <p className="mt-0.5 text-xs text-slate-400">PDF, DOCX, or TXT</p>
      </div>
      {fileInput}
      {status && (
        <p className="mt-1.5 text-xs text-slate-400" role="status">
          {status}
        </p>
      )}
    </div>
  );
}
