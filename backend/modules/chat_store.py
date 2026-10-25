"""SQLite-backed persistence for chats and their messages."""

import json
import sqlite3
import time
import uuid
from pathlib import Path

_db_path: Path | None = None


def init_db(path: Path):
    """Initialize the SQLite file and create tables if absent."""
    global _db_path
    _db_path = Path(path)
    _db_path.parent.mkdir(parents=True, exist_ok=True)
    with _connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS chats (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                sources_json TEXT,
                created_at REAL NOT NULL,
                FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, id);
            """
        )


def _connect() -> sqlite3.Connection:
    assert _db_path is not None, "chat_store.init_db() not called"
    conn = sqlite3.connect(_db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def create_chat(title: str = "New chat", chat_id: str | None = None) -> dict:
    chat_id = chat_id or str(uuid.uuid4())
    now = time.time()
    with _connect() as conn:
        conn.execute(
            "INSERT INTO chats(id, title, created_at, updated_at) VALUES (?,?,?,?)",
            (chat_id, title, now, now),
        )
    return {"id": chat_id, "title": title, "created_at": now, "updated_at": now}


def list_chats() -> list[dict]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT id, title, created_at, updated_at FROM chats ORDER BY updated_at DESC"
        ).fetchall()
    return [dict(r) for r in rows]


def get_chat(chat_id: str) -> dict | None:
    with _connect() as conn:
        row = conn.execute(
            "SELECT id, title, created_at, updated_at FROM chats WHERE id = ?",
            (chat_id,),
        ).fetchone()
    return dict(row) if row else None


def rename_chat(chat_id: str, title: str) -> None:
    with _connect() as conn:
        conn.execute(
            "UPDATE chats SET title = ?, updated_at = ? WHERE id = ?",
            (title, time.time(), chat_id),
        )


def delete_chat(chat_id: str) -> None:
    with _connect() as conn:
        conn.execute("DELETE FROM chats WHERE id = ?", (chat_id,))


def touch_chat(chat_id: str) -> None:
    """Bump updated_at so the chat sorts to the top after activity."""
    with _connect() as conn:
        conn.execute(
            "UPDATE chats SET updated_at = ? WHERE id = ?", (time.time(), chat_id)
        )


def append_message(
    chat_id: str, role: str, content: str, sources: list | None = None
) -> dict:
    now = time.time()
    sources_json = json.dumps(sources) if sources is not None else None
    with _connect() as conn:
        cur = conn.execute(
            "INSERT INTO messages(chat_id, role, content, sources_json, created_at) "
            "VALUES (?,?,?,?,?)",
            (chat_id, role, content, sources_json, now),
        )
        msg_id = cur.lastrowid
        conn.execute("UPDATE chats SET updated_at = ? WHERE id = ?", (now, chat_id))
    return {
        "id": msg_id,
        "chat_id": chat_id,
        "role": role,
        "content": content,
        "sources": sources or [],
        "created_at": now,
    }


def get_messages(chat_id: str) -> list[dict]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT id, chat_id, role, content, sources_json, created_at "
            "FROM messages WHERE chat_id = ? ORDER BY id ASC",
            (chat_id,),
        ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["sources"] = json.loads(d.pop("sources_json")) if d["sources_json"] else []
        out.append(d)
    return out


def last_n_turns(chat_id: str, n: int) -> list[dict]:
    """Return the last n user/assistant pairs (so up to 2n messages) in chronological order."""
    with _connect() as conn:
        rows = conn.execute(
            "SELECT role, content FROM messages WHERE chat_id = ? "
            "ORDER BY id DESC LIMIT ?",
            (chat_id, n * 2),
        ).fetchall()
    return [dict(r) for r in reversed(rows)]


def count_messages(chat_id: str) -> int:
    with _connect() as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS c FROM messages WHERE chat_id = ?", (chat_id,)
        ).fetchone()
    return int(row["c"])
