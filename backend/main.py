import base64
import json
import shutil
import uuid
from collections.abc import Iterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel

import config
from modules import asr, chat_store, ingestion, rag, tts, vector_store
from utils.sentences import iter_sentences

DEFAULT_CHAT_TITLE = "New chat"
TITLE_MAX_LEN = 40


@asynccontextmanager
async def lifespan(app: FastAPI):
    config.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    chat_store.init_db(config.CHAT_DB_PATH)
    _migrate_orphan_chunks_if_needed()
    asr.load_model()
    tts.load_pipeline()
    yield


def _migrate_orphan_chunks_if_needed():
    """If any pre-existing chunks lack chat_id, place them in an auto-created 'Default' chat."""
    chats = chat_store.list_chats()
    default = next((c for c in chats if c["title"] == "Default"), None)
    if default is None:
        default = chat_store.create_chat(title="Default")
    moved = vector_store.migrate_orphan_chunks(default["id"])
    if moved == 0 and not chats:
        # No orphans and we just created Default unnecessarily — but keep it as a starting chat.
        pass


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class QueryRequest(BaseModel):
    chat_id: str
    query: str


class SpeakRequest(BaseModel):
    text: str


class ChatCreateRequest(BaseModel):
    title: str | None = None


class ChatRenameRequest(BaseModel):
    title: str


def _save_upload(upload: UploadFile, dest: Path) -> None:
    with open(dest, "wb") as f:
        shutil.copyfileobj(upload.file, f)


def _require_chat(chat_id: str) -> dict:
    chat = chat_store.get_chat(chat_id)
    if chat is None:
        raise HTTPException(status_code=404, detail=f"chat {chat_id} not found")
    return chat


def _maybe_autotitle(chat: dict, user_text: str) -> None:
    """If this chat still has the default title, rename it from the first user query."""
    if chat["title"] == DEFAULT_CHAT_TITLE and chat_store.count_messages(chat["id"]) == 0:
        title = user_text.strip().splitlines()[0][:TITLE_MAX_LEN] or DEFAULT_CHAT_TITLE
        chat_store.rename_chat(chat["id"], title)


# ---------- Health ----------


@app.get("/health")
def health():
    return {"status": "ok"}


# ---------- Chats ----------


@app.post("/chats")
def chats_create(body: ChatCreateRequest | None = None):
    title = (body.title if body and body.title else DEFAULT_CHAT_TITLE).strip() or DEFAULT_CHAT_TITLE
    return chat_store.create_chat(title=title)


@app.get("/chats")
def chats_list():
    return chat_store.list_chats()


@app.get("/chats/{chat_id}")
def chats_get(chat_id: str):
    return _require_chat(chat_id)


@app.patch("/chats/{chat_id}")
def chats_rename(chat_id: str, body: ChatRenameRequest):
    _require_chat(chat_id)
    chat_store.rename_chat(chat_id, body.title.strip() or DEFAULT_CHAT_TITLE)
    return chat_store.get_chat(chat_id)


@app.delete("/chats/{chat_id}")
def chats_delete(chat_id: str):
    _require_chat(chat_id)
    try:
        vector_store.delete_chat_chunks(chat_id)
        chat_store.delete_chat(chat_id)
        return {"deleted": chat_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/chats/{chat_id}/messages")
def chats_messages(chat_id: str):
    _require_chat(chat_id)
    return chat_store.get_messages(chat_id)


# ---------- Documents (per-chat) ----------


@app.post("/ingest")
def ingest_route(
    file: UploadFile = File(...),
    chat_id: str = Form(...),
):
    _require_chat(chat_id)
    doc_id = str(uuid.uuid4())
    save_path = config.UPLOAD_DIR / f"{doc_id}_{file.filename}"
    try:
        _save_upload(file, save_path)
        return ingestion.ingest_document(str(save_path), doc_id, file.filename, chat_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        save_path.unlink(missing_ok=True)


@app.get("/documents")
def documents_route(chat_id: str):
    _require_chat(chat_id)
    try:
        return vector_store.list_documents(chat_id=chat_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/documents/{doc_id}")
def delete_route(doc_id: str):
    try:
        vector_store.delete_document(doc_id)
        return {"deleted": doc_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------- Query / Voice ----------


@app.post("/transcribe")
def transcribe_route(audio: UploadFile = File(...)):
    save_path = config.UPLOAD_DIR / f"audio_{uuid.uuid4()}.webm"
    try:
        _save_upload(audio, save_path)
        return {"transcript": asr.transcribe(str(save_path))}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        save_path.unlink(missing_ok=True)


@app.post("/query")
def query_route(body: QueryRequest):
    chat = _require_chat(body.chat_id)
    try:
        _maybe_autotitle(chat, body.query)
        chat_store.append_message(body.chat_id, "user", body.query)
        result = rag.answer_query(body.query, body.chat_id)
        chat_store.append_message(
            body.chat_id, "assistant", result["answer"], sources=result["sources"]
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/speak")
def speak_route(body: SpeakRequest):
    try:
        wav_bytes = tts.synthesize(body.text)
        return Response(content=wav_bytes, media_type="audio/wav")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/voice-query")
def voice_query_route(
    audio: UploadFile = File(...),
    chat_id: str = Form(...),
):
    chat = _require_chat(chat_id)
    save_path = config.UPLOAD_DIR / f"audio_{uuid.uuid4()}.webm"
    try:
        _save_upload(audio, save_path)
        transcript = asr.transcribe(str(save_path))
        _maybe_autotitle(chat, transcript)
        chat_store.append_message(chat_id, "user", transcript)
        result = rag.answer_query(transcript, chat_id)
        chat_store.append_message(
            chat_id, "assistant", result["answer"], sources=result["sources"]
        )
        wav_bytes = tts.synthesize(result["answer"])
        return {
            "transcript": transcript,
            "answer": result["answer"],
            "sources": result["sources"],
            "audio_base64": base64.b64encode(wav_bytes).decode(),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        save_path.unlink(missing_ok=True)


@app.post("/voice-query/stream")
def voice_query_stream_route(
    audio: UploadFile = File(...),
    chat_id: str = Form(...),
):
    """Streaming pipeline: emits NDJSON events (transcript, sources, sentence
    chunks with per-sentence audio, then done) so playback can start early."""
    chat = _require_chat(chat_id)
    save_path = config.UPLOAD_DIR / f"audio_{uuid.uuid4()}.webm"
    _save_upload(audio, save_path)

    def event(obj: dict) -> str:
        return json.dumps(obj) + "\n"

    def generate() -> Iterator[str]:
        full_answer_parts: list[str] = []
        sources_for_save: list[dict] = []
        try:
            transcript = asr.transcribe(str(save_path))
            yield event({"type": "transcript", "text": transcript})

            _maybe_autotitle(chat, transcript)
            chat_store.append_message(chat_id, "user", transcript)

            sources, prompt = rag.retrieve(transcript, chat_id)
            sources_for_save = sources
            yield event({"type": "sources", "sources": sources})

            seq = 0
            for sentence in iter_sentences(rag.stream_llm(prompt)):
                full_answer_parts.append(sentence)
                wav_bytes = tts.synthesize(sentence)
                yield event(
                    {
                        "type": "sentence",
                        "seq": seq,
                        "text": sentence,
                        "audio_b64": base64.b64encode(wav_bytes).decode(),
                    }
                )
                seq += 1

            chat_store.append_message(
                chat_id,
                "assistant",
                " ".join(full_answer_parts).strip(),
                sources=sources_for_save,
            )
            yield event({"type": "done"})
        except Exception as e:
            yield event({"type": "error", "detail": str(e)})
        finally:
            save_path.unlink(missing_ok=True)

    return StreamingResponse(generate(), media_type="application/x-ndjson")
