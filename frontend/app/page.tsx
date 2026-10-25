"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  type ChatInfo,
  type ChatMessage,
  type DocumentInfo,
  type SourceChunk,
} from "@/lib/api";
import { useAudioQueue } from "@/lib/useAudioQueue";
import ChatSidebar from "./components/ChatSidebar";
import DocumentUpload from "./components/DocumentUpload";
import DocumentList from "./components/DocumentList";
import VoiceRecorder, { type RecorderState } from "./components/VoiceRecorder";
import TranscriptView from "./components/TranscriptView";

export default function Home() {
  const [chats, setChats] = useState<ChatInfo[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const [documents, setDocuments] = useState<DocumentInfo[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const [recState, setRecState] = useState<RecorderState>("idle");
  const [liveTranscript, setLiveTranscript] = useState("");
  const [liveAnswer, setLiveAnswer] = useState("");
  const [liveSources, setLiveSources] = useState<SourceChunk[]>([]);
  const [askingSuggested, setAskingSuggested] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { prime, enqueue, reset } = useAudioQueue();
  const bootstrappedRef = useRef(false);

  useEffect(() => {
    if (bootstrappedRef.current) return;
    bootstrappedRef.current = true;
    (async () => {
      try {
        let list = await api.listChats();
        if (list.length === 0) {
          await api.createChat("New chat");
          list = await api.listChats();
        }
        setChats(list);
        setCurrentChatId(list[0]?.id ?? null);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, []);

  const refreshChats = useCallback(async () => {
    try {
      setChats(await api.listChats());
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const refreshDocuments = useCallback(async () => {
    if (!currentChatId) return;
    try {
      setDocuments(await api.listDocuments(currentChatId));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [currentChatId]);

  const refreshMessages = useCallback(async () => {
    if (!currentChatId) return;
    try {
      setMessages(await api.getMessages(currentChatId));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [currentChatId]);

  useEffect(() => {
    if (!currentChatId) return;
    reset();
    setLiveTranscript("");
    setLiveAnswer("");
    setLiveSources([]);
    setError(null);
    refreshDocuments();
    refreshMessages();
  }, [currentChatId, reset, refreshDocuments, refreshMessages]);

  useEffect(() => {
    if (currentChatId && !chats.find((c) => c.id === currentChatId)) {
      setCurrentChatId(chats[0]?.id ?? null);
    }
  }, [chats, currentChatId]);

  function handleStart() {
    reset();
    setError(null);
    setLiveTranscript("");
    setLiveAnswer("");
    setLiveSources([]);
    prime();
  }

  async function handleRecorded(blob: Blob) {
    if (!currentChatId) return;
    await api.voiceQueryStream(blob, currentChatId, {
      onTranscript: setLiveTranscript,
      onSources: setLiveSources,
      onSentence: (_seq, text, audioB64) => {
        setLiveAnswer((prev) => (prev ? `${prev} ${text}` : text));
        enqueue(audioB64);
      },
      onError: (detail) => {
        setError(detail);
        setRecState("idle");
      },
      onDone: async () => {
        setRecState("idle");
        await Promise.all([refreshMessages(), refreshChats()]);
        setLiveTranscript("");
        setLiveAnswer("");
        setLiveSources([]);
      },
    });
  }

  async function askSuggested(prompt: string) {
    if (!currentChatId || askingSuggested) return;
    setAskingSuggested(true);
    setError(null);
    try {
      await api.query(currentChatId, prompt);
      await Promise.all([refreshMessages(), refreshChats()]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAskingSuggested(false);
    }
  }

  const currentChat = chats.find((c) => c.id === currentChatId) ?? null;
  const liveTurn =
    liveTranscript || liveAnswer
      ? {
          transcript: liveTranscript,
          answer: liveAnswer,
          sources: liveSources,
        }
      : null;

  return (
    <main className="flex h-screen w-screen overflow-hidden bg-white">
      <ChatSidebar
        chats={chats}
        currentChatId={currentChatId}
        onSelect={setCurrentChatId}
        onChange={refreshChats}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed((v) => !v)}
      />

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header band — subtle horizon gradient */}
        <header className="border-b border-slate-200 bg-gradient-to-b from-slate-50 to-white px-6 py-3">
          <h1 className="text-base font-semibold text-slate-800">
            {currentChat ? currentChat.title : "VoiceRAG"}
          </h1>
          <p className="text-xs text-slate-400">
            {documents.length > 0
              ? `${documents.length} document${documents.length === 1 ? "" : "s"} in this chat`
              : "Local voice-powered document assistant"}
          </p>
        </header>

        {!currentChatId ? (
          <div className="flex flex-1 items-center justify-center text-sm text-slate-400">
            No chat selected.
          </div>
        ) : (
          <div key={currentChatId} className="flex flex-1 flex-col overflow-hidden">
            {/* Docs strip — compact when populated, dropzone when empty */}
            <section className="border-b border-slate-100 bg-white px-6 py-3">
              {documents.length === 0 ? (
                <DocumentUpload chatId={currentChatId} onUploaded={refreshDocuments} />
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <DocumentList documents={documents} onChanged={refreshDocuments} />
                  <DocumentUpload
                    chatId={currentChatId}
                    onUploaded={refreshDocuments}
                    compact
                  />
                </div>
              )}
            </section>

            {/* Conversation */}
            <section className="flex-1 overflow-y-auto bg-slate-50/40 px-6 py-6">
              <TranscriptView
                messages={messages}
                live={liveTurn}
                hasDocuments={documents.length > 0}
                onAskSuggested={askSuggested}
              />
              {error && (
                <p
                  className="mx-auto mt-3 max-w-3xl text-sm text-red-600"
                  role="alert"
                >
                  {error}
                </p>
              )}
              {askingSuggested && (
                <p className="mx-auto mt-3 max-w-3xl text-xs text-slate-400">
                  Thinking…
                </p>
              )}
            </section>

            {/* Recorder pedestal */}
            <section className="border-t border-slate-200 bg-gradient-to-t from-slate-50 to-white px-6 py-5">
              <VoiceRecorder
                state={recState}
                onState={setRecState}
                onStart={handleStart}
                onRecorded={handleRecorded}
              />
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
