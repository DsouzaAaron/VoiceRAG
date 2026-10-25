"use client";

import { useEffect, useRef } from "react";
import { type ChatMessage, type SourceChunk } from "@/lib/api";
import RetrievedChunks from "./RetrievedChunks";
import { MicIcon, SparklesIcon } from "./icons";

interface LiveTurn {
  transcript: string;
  answer: string;
  sources: SourceChunk[];
}

const SUGGESTED_PROMPTS = [
  "Summarize the document in 3 sentences",
  "What are the key takeaways?",
  "List the most important facts and figures",
];

export default function TranscriptView({
  messages,
  live,
  hasDocuments,
  onAskSuggested,
}: {
  messages: ChatMessage[];
  live?: LiveTurn | null;
  hasDocuments: boolean;
  onAskSuggested?: (prompt: string) => void;
}) {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, live?.transcript, live?.answer]);

  if (messages.length === 0 && !live) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-lg">
          <SparklesIcon className="h-7 w-7" />
        </div>
        <h2 className="mt-4 text-lg font-semibold text-slate-800">
          {hasDocuments
            ? "Ask anything about your documents"
            : "Upload a document to begin"}
        </h2>
        <p className="mt-1 max-w-md text-sm text-slate-500">
          {hasDocuments ? (
            <>
              Tap the mic and speak naturally, or try one of these prompts.
            </>
          ) : (
            <>
              Drop a PDF, DOCX, or TXT above. Once it's ingested you can ask
              questions by voice.
            </>
          )}
        </p>

        {hasDocuments && (
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            {SUGGESTED_PROMPTS.map((p) => (
              <button
                key={p}
                onClick={() => onAskSuggested?.(p)}
                className="rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition hover:border-indigo-300 hover:text-indigo-600 hover:shadow"
              >
                {p}
              </button>
            ))}
          </div>
        )}

        <div className="mt-6 inline-flex items-center gap-1.5 text-xs text-slate-400">
          <MicIcon className="h-3.5 w-3.5" />
          Or click the mic below
        </div>
      </div>
    );
  }

  // Group messages into [user, assistant] pairs so each turn renders together.
  const turns: { user: ChatMessage; assistant: ChatMessage | null }[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === "user") {
      const next = messages[i + 1];
      const assistant = next && next.role === "assistant" ? next : null;
      turns.push({ user: m, assistant });
      if (assistant) i++;
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      {turns.map(({ user, assistant }) => (
        <Turn
          key={user.id}
          userText={user.content}
          answerText={assistant?.content ?? ""}
          sources={assistant?.sources ?? []}
        />
      ))}
      {live && (live.transcript || live.answer) && (
        <Turn
          userText={live.transcript}
          answerText={live.answer}
          sources={live.sources}
          live
        />
      )}
      <div ref={bottomRef} />
    </div>
  );
}

function Turn({
  userText,
  answerText,
  sources,
  live,
}: {
  userText: string;
  answerText: string;
  sources: SourceChunk[];
  live?: boolean;
}) {
  return (
    <div className="animate-fade-in space-y-2">
      {userText && (
        <div className="ml-auto max-w-[85%] rounded-2xl rounded-tr-md bg-slate-900 px-4 py-2.5 text-sm text-slate-50 shadow-sm">
          {userText}
        </div>
      )}
      {(answerText || live) && (
        <div
          className={`max-w-[90%] rounded-2xl rounded-tl-md px-4 py-3 shadow-sm transition ${
            live
              ? "border border-indigo-200 bg-gradient-to-br from-indigo-50 to-white"
              : "border border-slate-100 bg-white"
          }`}
        >
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-indigo-400">
            Answer{live && !answerText ? " · thinking…" : ""}
          </p>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
            {answerText}
          </p>
        </div>
      )}
      {sources.length > 0 && (
        <div className="max-w-[90%]">
          <RetrievedChunks sources={sources} />
        </div>
      )}
    </div>
  );
}
