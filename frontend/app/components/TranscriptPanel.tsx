"use client";

export default function TranscriptPanel({
  transcript,
  answer,
}: {
  transcript: string;
  answer: string;
}) {
  return (
    <div className="space-y-3">
      <div className="rounded-lg bg-slate-100 px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          You said
        </p>
        <p className="mt-1 text-sm text-slate-700">{transcript}</p>
      </div>
      <div className="rounded-lg border border-indigo-100 bg-indigo-50 px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-indigo-400">
          Answer
        </p>
        <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">
          {answer}
        </p>
      </div>
    </div>
  );
}
