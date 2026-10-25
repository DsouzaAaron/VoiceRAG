"use client";

import { useState } from "react";
import { api, type ChatInfo } from "@/lib/api";
import { relativeTime } from "@/lib/time";
import {
  ChatBubbleIcon,
  ChevronLeftIcon,
  MenuIcon,
  MicIcon,
  PencilIcon,
  PlusIcon,
  XIcon,
} from "./icons";

export default function ChatSidebar({
  chats,
  currentChatId,
  onSelect,
  onChange,
  collapsed,
  onToggleCollapsed,
}: {
  chats: ChatInfo[];
  currentChatId: string | null;
  onSelect: (chatId: string) => void;
  onChange: () => Promise<void> | void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [busy, setBusy] = useState(false);

  async function createChat() {
    setBusy(true);
    try {
      const chat = await api.createChat();
      await onChange();
      onSelect(chat.id);
    } finally {
      setBusy(false);
    }
  }

  async function deleteChat(chatId: string) {
    if (
      !confirm(
        "Delete this chat? Its documents and conversation history will be removed."
      )
    )
      return;
    await api.deleteChat(chatId);
    onChange();
  }

  function startRename(chat: ChatInfo) {
    setRenamingId(chat.id);
    setRenameValue(chat.title);
  }

  async function commitRename(chatId: string) {
    const t = renameValue.trim();
    if (t) await api.renameChat(chatId, t);
    setRenamingId(null);
    onChange();
  }

  if (collapsed) {
    return (
      <aside className="flex w-14 shrink-0 flex-col items-center border-r border-slate-200 bg-slate-100/70 py-3">
        <button
          onClick={onToggleCollapsed}
          aria-label="Expand sidebar"
          className="rounded-md p-2 text-slate-500 transition hover:bg-slate-200/70"
        >
          <MenuIcon className="h-5 w-5" />
        </button>
        <div className="mt-3 flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-sm">
          <MicIcon className="h-4 w-4" />
        </div>
        <button
          onClick={createChat}
          disabled={busy}
          aria-label="New chat"
          className="mt-4 flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-50"
        >
          <PlusIcon className="h-4 w-4" />
        </button>
      </aside>
    );
  }

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-slate-200 bg-slate-100/70">
      {/* Brand header */}
      <div className="flex items-center justify-between border-b border-slate-200/80 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-sm">
            <MicIcon className="h-4 w-4" />
          </div>
          <div className="leading-tight">
            <p className="text-sm font-semibold text-slate-800">VoiceRAG</p>
            <p className="text-[10px] uppercase tracking-wider text-slate-400">
              local · private
            </p>
          </div>
        </div>
        <button
          onClick={onToggleCollapsed}
          aria-label="Collapse sidebar"
          className="rounded p-1 text-slate-400 transition hover:bg-slate-200/70 hover:text-slate-600"
        >
          <ChevronLeftIcon className="h-4 w-4" />
        </button>
      </div>

      <div className="px-3 pt-3">
        <button
          onClick={createChat}
          disabled={busy}
          className="flex w-full items-center justify-center gap-1.5 rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-50"
        >
          <PlusIcon className="h-4 w-4" />
          New chat
        </button>
      </div>

      <ul className="flex-1 overflow-y-auto px-2 py-3">
        {chats.length === 0 && (
          <li className="px-2 py-3 text-xs text-slate-400">No chats yet.</li>
        )}
        {chats.map((chat) => {
          const active = chat.id === currentChatId;
          const isRenaming = renamingId === chat.id;
          return (
            <li
              key={chat.id}
              className={`group relative mb-1 flex items-center gap-2 rounded-md px-2 py-2 text-sm transition ${
                active
                  ? "bg-white text-slate-800 shadow-sm"
                  : "text-slate-600 hover:bg-white/70"
              }`}
            >
              {active && (
                <span
                  aria-hidden
                  className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-indigo-500"
                />
              )}
              <ChatBubbleIcon
                className={`h-4 w-4 shrink-0 ${
                  active ? "text-indigo-500" : "text-slate-400"
                }`}
              />

              {isRenaming ? (
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => commitRename(chat.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename(chat.id);
                    if (e.key === "Escape") setRenamingId(null);
                  }}
                  className="w-full rounded border border-slate-300 bg-white px-1.5 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-400"
                />
              ) : (
                <button
                  onClick={() => onSelect(chat.id)}
                  onDoubleClick={() => startRename(chat)}
                  className="min-w-0 flex-1 text-left"
                  title={chat.title}
                >
                  <p className="truncate font-medium leading-tight">
                    {chat.title}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    {relativeTime(chat.updated_at)}
                  </p>
                </button>
              )}

              {!isRenaming && (
                <div className="ml-1 hidden shrink-0 items-center gap-0.5 group-hover:flex">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      startRename(chat);
                    }}
                    className="rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                    aria-label="Rename"
                  >
                    <PencilIcon className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteChat(chat.id);
                    }}
                    className="rounded p-1 text-slate-400 transition hover:bg-red-50 hover:text-red-500"
                    aria-label="Delete"
                  >
                    <XIcon className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
