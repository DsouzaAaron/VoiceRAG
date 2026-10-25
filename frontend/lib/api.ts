const BASE = "http://localhost:8000";

export interface ChatInfo {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
}

export interface DocumentInfo {
  doc_id: string;
  filename: string;
  chunk_count: number;
}

export interface IngestResult {
  doc_id: string;
  filename: string;
  chunk_count: number;
  status: string;
}

export interface SourceChunk {
  text: string;
  metadata: {
    doc_id: string;
    chat_id: string;
    filename: string;
    chunk_index: number;
    source_type: string;
    page: number | null;
  };
  distance: number;
}

export interface ChatMessage {
  id: number;
  chat_id: string;
  role: "user" | "assistant";
  content: string;
  sources: SourceChunk[];
  created_at: number;
}

export interface VoiceQueryResult {
  transcript: string;
  answer: string;
  sources: SourceChunk[];
  audio_base64: string;
}

export interface StreamHandlers {
  onTranscript?: (text: string) => void;
  onSources?: (sources: SourceChunk[]) => void;
  onSentence?: (seq: number, text: string, audioB64: string) => void;
  onError?: (detail: string) => void;
  onDone?: () => void;
}

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail ?? detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export const api = {
  // ---------- Chats ----------
  createChat: async (title?: string): Promise<ChatInfo> =>
    asJson(
      await fetch(`${BASE}/chats`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title ?? null }),
      })
    ),

  listChats: async (): Promise<ChatInfo[]> =>
    asJson(await fetch(`${BASE}/chats`)),

  renameChat: async (chatId: string, title: string): Promise<ChatInfo> =>
    asJson(
      await fetch(`${BASE}/chats/${chatId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      })
    ),

  deleteChat: async (chatId: string): Promise<{ deleted: string }> =>
    asJson(await fetch(`${BASE}/chats/${chatId}`, { method: "DELETE" })),

  getMessages: async (chatId: string): Promise<ChatMessage[]> =>
    asJson(await fetch(`${BASE}/chats/${chatId}/messages`)),

  // ---------- Documents (per-chat) ----------
  ingestDocument: async (file: File, chatId: string): Promise<IngestResult> => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("chat_id", chatId);
    return asJson(await fetch(`${BASE}/ingest`, { method: "POST", body: fd }));
  },

  listDocuments: async (chatId: string): Promise<DocumentInfo[]> =>
    asJson(await fetch(`${BASE}/documents?chat_id=${encodeURIComponent(chatId)}`)),

  deleteDocument: async (docId: string): Promise<{ deleted: string }> =>
    asJson(await fetch(`${BASE}/documents/${docId}`, { method: "DELETE" })),

  // ---------- Query / voice ----------
  query: async (
    chatId: string,
    query: string
  ): Promise<{ answer: string; sources: SourceChunk[] }> =>
    asJson(
      await fetch(`${BASE}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, query }),
      })
    ),

  voiceQuery: async (blob: Blob, chatId: string): Promise<VoiceQueryResult> => {
    const fd = new FormData();
    fd.append("audio", blob, "recording.webm");
    fd.append("chat_id", chatId);
    return asJson(
      await fetch(`${BASE}/voice-query`, { method: "POST", body: fd })
    );
  },

  voiceQueryStream: async (
    blob: Blob,
    chatId: string,
    handlers: StreamHandlers
  ): Promise<void> => {
    const fd = new FormData();
    fd.append("audio", blob, "recording.webm");
    fd.append("chat_id", chatId);
    const res = await fetch(`${BASE}/voice-query/stream`, {
      method: "POST",
      body: fd,
    });
    if (!res.ok || !res.body) {
      handlers.onError?.(res.statusText || "stream request failed");
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const dispatch = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let evt: Record<string, unknown>;
      try {
        evt = JSON.parse(trimmed);
      } catch {
        return;
      }
      switch (evt.type) {
        case "transcript":
          handlers.onTranscript?.(evt.text as string);
          break;
        case "sources":
          handlers.onSources?.(evt.sources as SourceChunk[]);
          break;
        case "sentence":
          handlers.onSentence?.(
            evt.seq as number,
            evt.text as string,
            evt.audio_b64 as string
          );
          break;
        case "error":
          handlers.onError?.(evt.detail as string);
          break;
        case "done":
          handlers.onDone?.();
          break;
      }
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        dispatch(line);
      }
    }
    if (buffer.trim()) dispatch(buffer);
  },
};
