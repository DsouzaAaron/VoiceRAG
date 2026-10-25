"use client";

import { useState } from "react";
import { api, type DocumentInfo } from "@/lib/api";
import { DocIcon, XIcon } from "./icons";

export default function DocumentList({
  documents,
  onChanged,
}: {
  documents: DocumentInfo[];
  onChanged: () => void;
}) {
  const [deleting, setDeleting] = useState<string | null>(null);

  async function remove(docId: string) {
    setDeleting(docId);
    try {
      await api.deleteDocument(docId);
      onChanged();
    } finally {
      setDeleting(null);
    }
  }

  if (documents.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {documents.map((doc) => {
        const isDeleting = deleting === doc.doc_id;
        return (
          <div
            key={doc.doc_id}
            className={`group inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white py-1 pl-2.5 pr-1 text-xs shadow-sm transition ${
              isDeleting ? "opacity-40" : "hover:border-slate-300"
            }`}
          >
            <DocIcon className="h-3.5 w-3.5 text-slate-400" />
            <span
              className="max-w-[14rem] truncate font-medium text-slate-700"
              title={doc.filename}
            >
              {doc.filename}
            </span>
            <span className="text-slate-400">·</span>
            <span className="text-slate-400">{doc.chunk_count} chunks</span>
            <button
              onClick={() => remove(doc.doc_id)}
              disabled={isDeleting}
              aria-label={`Remove ${doc.filename}`}
              className="ml-1 rounded-full p-1 text-slate-300 transition hover:bg-red-50 hover:text-red-500"
            >
              <XIcon className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
