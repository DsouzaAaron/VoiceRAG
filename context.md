# VoiceRAG — Local Voice-Powered Document Assistant
## Project Plan v3 — Cross-Platform (macOS + Windows)

---

## Overview

Build a fully local, offline-capable voice assistant that lets users upload documents (PDF, DOCX, TXT) and query them using natural speech. No data leaves the machine. Runs on macOS (Apple Silicon) and Windows — no CUDA required, CPU only.

**v1 scope:** PDF + DOCX + TXT text extraction, full voice round-trip (mic → ASR → RAG → TTS). Image/chart understanding (LLaVA) is a clearly marked v2 extension — do not implement in v1.

---

## Hardware Context

**Primary dev machine: M2 MacBook Pro, 16GB RAM.** Target: also runs on Windows (Intel/AMD CPU, 8GB+ RAM, no GPU required).

- **No CUDA.** All inference is CPU only. Do not use `device="cuda"` anywhere.
- **faster-whisper:** `device="cpu"`, `compute_type="int8"`. Use `small` model for speed, `medium` for better accuracy. Do NOT use `large-v3`.
- **Ollama LLM:** `llama3.2:3b` (fast, low RAM) or `mistral:7b` (better quality). Do NOT run LLaVA simultaneously — two 7B models will thrash 16GB RAM.
- **Kokoro TTS:** CPU only, ~300MB weights, fine on both platforms.
- **Concurrency:** single-user local tool. Do not over-engineer.

---

## Tech Stack

| Layer | Tool | Notes |
|---|---|---|
| ASR | faster-whisper `small` or `medium` | CPU, int8 |
| LLM | Ollama — `llama3.2:3b` or `mistral:7b` | one at a time |
| Embedding | `nomic-embed-text` via Ollama | separate, lightweight |
| Vector DB | ChromaDB (persistent local) | |
| PDF parsing | PyMuPDF (fitz) | |
| DOCX parsing | python-docx | |
| TXT parsing | plain Python | |
| TTS | Kokoro TTS | needs `espeak-ng` — platform install differs |
| Backend | FastAPI (sync routes) | see threading note below |
| Frontend | Next.js 14 + Tailwind CSS | |

**Removed from v1:** LLaVA, PyAudio/sounddevice (audio captured in browser, not backend)

---

## Critical: Sync Routes, Not Async

All ML/IO-heavy routes (ingest, transcribe, query, voice-query) must be defined as **sync `def`**, not `async def`. FastAPI automatically runs sync routes in a thread pool, keeping the event loop unblocked.

```python
# CORRECT — FastAPI offloads to thread pool automatically
@app.post("/query")
def query_route(body: QueryRequest):
    return rag.answer_query(body.query)

# WRONG — blocks the event loop, freezes all other requests
@app.post("/query")
async def query_route(body: QueryRequest):
    return rag.answer_query(body.query)  # blocking call inside async!
```

**Rule:** Only use `async def` for routes that do nothing but await real async I/O. Whisper, Kokoro, and Ollama HTTP calls are all blocking — use sync `def` for anything that calls them.

---

## Repo Structure

```
voicerag/
├── backend/
│   ├── main.py                  # FastAPI app, all routes
│   ├── config.py                # all constants
│   ├── modules/
│   │   ├── ingestion.py         # parsing, chunking, storing
│   │   ├── vector_store.py      # ChromaDB wrapper
│   │   ├── asr.py               # faster-whisper transcription
│   │   ├── rag.py               # query + retrieval + Ollama LLM
│   │   └── tts.py               # Kokoro TTS → wav bytes
│   ├── utils/
│   │   ├── chunker.py           # RecursiveCharacterTextSplitter wrapper
│   │   └── embeddings.py        # embed_text() — shared by ingestion and rag
│   └── requirements.txt
├── frontend/
│   ├── app/
│   │   ├── page.tsx
│   │   ├── layout.tsx
│   │   └── components/
│   │       ├── DocumentUpload.tsx
│   │       ├── DocumentList.tsx
│   │       ├── VoiceRecorder.tsx
│   │       ├── TranscriptPanel.tsx
│   │       ├── RetrievedChunks.tsx
│   │       └── AudioPlayer.tsx
│   ├── lib/
│   │   └── api.ts
│   └── package.json
├── chroma_db/                   # auto-created, gitignored
├── uploads/                     # temp uploads, gitignored
├── .gitignore                   # chroma_db/, uploads/, venv/, __pycache__/, .env
└── README.md                    # must include platform-specific setup sections
```

---

## Module Specifications

### 1. `config.py`

```python
OLLAMA_BASE_URL = "http://localhost:11434"
LLM_MODEL = "llama3.2:3b"           # fast on M2; swap to mistral:7b for quality
EMBED_MODEL = "nomic-embed-text"
WHISPER_MODEL = "small"              # "medium" if latency is acceptable
WHISPER_DEVICE = "cpu"
WHISPER_COMPUTE_TYPE = "int8"
CHROMA_DB_PATH = "./chroma_db"
UPLOAD_DIR = "./uploads"
CHUNK_SIZE = 500
CHUNK_OVERLAP = 50
TOP_K_RETRIEVAL = 4

# v2 only — do not use in v1
# VISION_MODEL = "llava:7b"
```

---

### 2. `modules/ingestion.py`

**v1 scope:** text extraction only from PDF, DOCX, TXT. Images are skipped silently. Chunking is done **per page** for PDF (so page numbers are reliable), and per document for DOCX/TXT.

```python
from utils.embeddings import embed_text
from utils.chunker import chunk_text
from modules import vector_store
import config, fitz
from pathlib import Path
from docx import Document

def ingest_document(file_path: str, doc_id: str, filename: str) -> dict:
    """Main entry point. Detects file type, parses, chunks, embeds, stores.
    Returns {doc_id, filename, chunk_count, status}"""
    suffix = Path(file_path).suffix.lower()
    if suffix == ".pdf":
        blocks = parse_pdf(file_path)
    elif suffix == ".docx":
        blocks = parse_docx(file_path)
    elif suffix == ".txt":
        blocks = parse_txt(file_path)
    else:
        raise ValueError(f"Unsupported file type: {suffix}")

    all_chunks, all_embeddings, all_metadatas, all_ids = [], [], [], []
    chunk_index = 0
    for block in blocks:
        chunks = chunk_text(block["content"], config.CHUNK_SIZE, config.CHUNK_OVERLAP)
        for chunk in chunks:
            embedding = embed_text(chunk)
            all_chunks.append(chunk)
            all_embeddings.append(embedding)
            all_metadatas.append({
                "doc_id": doc_id,
                "filename": filename,
                "chunk_index": chunk_index,
                "source_type": "text",
                "page": block["page"],   # int for PDF, None for DOCX/TXT
            })
            all_ids.append(f"{doc_id}_chunk_{chunk_index}")
            chunk_index += 1

    vector_store.add_chunks(all_chunks, all_embeddings, all_metadatas, all_ids)
    return {"doc_id": doc_id, "filename": filename, "chunk_count": chunk_index, "status": "ok"}


def parse_pdf(file_path: str) -> list[dict]:
    """Chunk per page so page numbers are accurate in metadata.
    Returns list of {content: str, page: int} — one entry per non-empty page."""
    doc = fitz.open(file_path)
    blocks = []
    for page_num, page in enumerate(doc):
        text = page.get_text().strip()
        if text:
            blocks.append({"content": text, "page": page_num + 1})  # 1-indexed
    return blocks


def parse_docx(file_path: str) -> list[dict]:
    """Extract all paragraphs and table cells as one block.
    page is None — DOCX has no reliable page boundary info.
    Returns [{content: str, page: None}]"""
    doc = Document(file_path)
    parts = [p.text for p in doc.paragraphs if p.text.strip()]
    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                if cell.text.strip():
                    parts.append(cell.text.strip())
    return [{"content": "\n".join(parts), "page": None}]


def parse_txt(file_path: str) -> list[dict]:
    """Read as UTF-8. Returns [{content: str, page: None}]"""
    text = Path(file_path).read_text(encoding="utf-8")
    return [{"content": text, "page": None}]
```

**Metadata per chunk:**
```python
{
    "doc_id": str,
    "filename": str,
    "chunk_index": int,
    "source_type": "text",        # v2 will add "image_description"
    "page": int | None,           # int for PDF (1-indexed), None for DOCX/TXT
}
```

**Why per-page chunking for PDF:** chunking the full concatenated document loses page attribution — a chunk could straddle pages with no reliable way to tag it. Chunking per page means every chunk is tagged with a real page number, making the Sources UI display ("from page 4") accurate. The only tradeoff is slightly worse chunking at page seams, which is acceptable.

---

### 3. `utils/chunker.py`

```python
from langchain_text_splitters import RecursiveCharacterTextSplitter

def chunk_text(text: str, chunk_size: int = 500, overlap: int = 50) -> list[str]:
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=chunk_size,
        chunk_overlap=overlap,
        separators=["\n\n", "\n", ". ", " ", ""]
    )
    return splitter.split_text(text)
```

---

### 3b. `utils/embeddings.py`

Shared embedding helper. Imported by both `ingestion.py` (to embed chunks) and `rag.py` (to embed queries) so neither module depends on the other.

```python
import requests
import config

def embed_text(text: str) -> list[float]:
    """Embed a single string via Ollama nomic-embed-text.
    POST to {OLLAMA_BASE_URL}/api/embeddings, return the embedding list."""
    resp = requests.post(
        f"{config.OLLAMA_BASE_URL}/api/embeddings",
        json={"model": config.EMBED_MODEL, "prompt": text},
        timeout=60
    )
    resp.raise_for_status()
    return resp.json()["embedding"]
```

---

### 4. `modules/vector_store.py`

```python
import chromadb

_client = None
_collection = None

def get_collection():
    """Initialize once, return persistent collection 'voicerag'."""
    global _client, _collection
    if _collection is None:
        _client = chromadb.PersistentClient(path=CHROMA_DB_PATH)
        _collection = _client.get_or_create_collection("voicerag")
    return _collection

def add_chunks(chunks: list[str], embeddings: list[list[float]],
               metadatas: list[dict], ids: list[str]):
    """Upsert chunks. IDs format: '{doc_id}_chunk_{i}'"""
    get_collection().upsert(documents=chunks, embeddings=embeddings,
                             metadatas=metadatas, ids=ids)

def query(query_embedding: list[float], top_k: int = 4) -> list[dict]:
    """Returns list of {text, metadata, distance}"""
    results = get_collection().query(query_embeddings=[query_embedding], n_results=top_k)
    return [
        {"text": doc, "metadata": meta, "distance": dist}
        for doc, meta, dist in zip(
            results["documents"][0],
            results["metadatas"][0],
            results["distances"][0]
        )
    ]

def delete_document(doc_id: str):
    """Delete all chunks with metadata.doc_id == doc_id"""
    get_collection().delete(where={"doc_id": doc_id})

def list_documents() -> list[dict]:
    """Return unique docs as [{doc_id, filename, chunk_count}]"""
    # get_collection().get() → iterate metadatas, deduplicate by doc_id
```

---

### 5. `modules/asr.py`

```python
from faster_whisper import WhisperModel
import config

_model = None

def load_model():
    """Called once at startup via lifespan."""
    global _model
    _model = WhisperModel(
        config.WHISPER_MODEL,
        device=config.WHISPER_DEVICE,
        compute_type=config.WHISPER_COMPUTE_TYPE
    )

def transcribe(audio_path: str) -> str:
    """Transcribe audio file, return full transcript string."""
    segments, _ = _model.transcribe(audio_path, beam_size=5)
    return " ".join(segment.text.strip() for segment in segments)
```

**Important note on audio format:** faster-whisper uses PyAV internally and handles `audio/webm` (what `MediaRecorder` produces in Chrome/Safari) directly — no manual ffmpeg conversion step needed. Do NOT add a subprocess ffmpeg call. If a specific browser produces a format that fails, handle it as a targeted fix, not a blanket conversion.

**Singleton:** `_model` is module-level. `load_model()` is called once in lifespan. All routes call `transcribe()` directly — the model is already in memory.

---

### 6. `modules/rag.py`

```python
import requests
import config
from modules import vector_store
from utils.embeddings import embed_text

def answer_query(query_text: str) -> dict:
    """Full RAG pipeline.
    Returns {answer: str, sources: list[{text, metadata, distance}]}"""
    query_embedding = embed_text(query_text)
    chunks = vector_store.query(query_embedding, top_k=config.TOP_K_RETRIEVAL)
    prompt = build_prompt(query_text, [c["text"] for c in chunks])
    answer = call_ollama_llm(prompt)
    return {"answer": answer, "sources": chunks}

def build_prompt(query: str, context_chunks: list[str]) -> str:
    context = "\n\n---\n\n".join(context_chunks)
    return f"""You are a helpful assistant. Answer the question using only the context below.
If the answer is not in the context, say "I don't have enough information to answer that."
Do not make up information.

Context:
{context}

Question: {query}

Answer:"""

def call_ollama_llm(prompt: str) -> str:
    """POST to Ollama /api/generate, stream=False, return response string."""
    resp = requests.post(
        f"{config.OLLAMA_BASE_URL}/api/generate",
        json={"model": config.LLM_MODEL, "prompt": prompt, "stream": False},
        timeout=120
    )
    resp.raise_for_status()
    return resp.json()["response"].strip()
```

---

### 7. `modules/tts.py`

```python
import io
import numpy as np
import soundfile as sf

_pipeline = None

def load_pipeline():
    """Called once at startup via lifespan. Downloads ~300MB on first run.
    Requires espeak-ng: brew install espeak-ng"""
    global _pipeline
    from kokoro import KPipeline
    _pipeline = KPipeline(lang_code='a')   # 'a' = American English

def synthesize(text: str) -> bytes:
    """Synthesize text to speech. Returns wav bytes."""
    generator = _pipeline(text, voice='af_heart', speed=1.0)
    audio_chunks = [audio for _, _, audio in generator]
    audio_data = np.concatenate(audio_chunks)
    buf = io.BytesIO()
    sf.write(buf, audio_data, samplerate=24000, format='WAV')
    buf.seek(0)
    return buf.read()
```

**System dependency (macOS):** Kokoro requires `espeak-ng` for phonemization.
```bash
brew install espeak-ng
```
This is a hard prerequisite. Without it, `KPipeline` will fail at import or first synthesis call with a confusing error. It must be in the README prerequisites prominently.

---

### 8. `main.py` — FastAPI Routes

```python
from contextlib import asynccontextmanager
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel
import uuid, os, shutil, base64

from modules import asr, tts, ingestion, rag
import config

@asynccontextmanager
async def lifespan(app: FastAPI):
    os.makedirs(config.UPLOAD_DIR, exist_ok=True)
    asr.load_model()
    tts.load_pipeline()
    yield

app = FastAPI(lifespan=lifespan)
app.add_middleware(CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"], allow_headers=["*"])
```

**All routes below are sync `def`:**

```
GET    /health             → {status: "ok"}
POST   /ingest             → {doc_id, filename, chunk_count, status}
GET    /documents          → [{doc_id, filename, chunk_count}]
DELETE /documents/{doc_id} → {deleted: doc_id}
POST   /transcribe         → {transcript: str}
POST   /query              → {answer: str, sources: [{text, metadata}]}
POST   /speak              → audio/wav bytes (Response)
POST   /voice-query        → {transcript, answer, sources, audio_base64}
```

**Route implementation sketches:**

```python
# POST /ingest
def ingest_route(file: UploadFile = File(...)):
    doc_id = str(uuid.uuid4())
    save_path = f"{config.UPLOAD_DIR}/{doc_id}_{file.filename}"
    with open(save_path, "wb") as f:
        shutil.copyfileobj(file.file, f)
    result = ingestion.ingest_document(save_path, doc_id, file.filename)
    os.remove(save_path)
    return result

# POST /transcribe
def transcribe_route(audio: UploadFile = File(...)):
    save_path = f"{config.UPLOAD_DIR}/audio_{uuid.uuid4()}.webm"
    with open(save_path, "wb") as f:
        shutil.copyfileobj(audio.file, f)
    transcript = asr.transcribe(save_path)
    os.remove(save_path)
    return {"transcript": transcript}

# POST /query
class QueryRequest(BaseModel):
    query: str

def query_route(body: QueryRequest):
    return rag.answer_query(body.query)

# POST /speak
class SpeakRequest(BaseModel):
    text: str

def speak_route(body: SpeakRequest):
    wav_bytes = tts.synthesize(body.text)
    return Response(content=wav_bytes, media_type="audio/wav")

# POST /voice-query
def voice_query_route(audio: UploadFile = File(...)):
    save_path = f"{config.UPLOAD_DIR}/audio_{uuid.uuid4()}.webm"
    with open(save_path, "wb") as f:
        shutil.copyfileobj(audio.file, f)
    transcript = asr.transcribe(save_path)
    os.remove(save_path)
    result = rag.answer_query(transcript)
    wav_bytes = tts.synthesize(result["answer"])
    return {
        "transcript": transcript,
        "answer": result["answer"],
        "sources": result["sources"],
        "audio_base64": base64.b64encode(wav_bytes).decode()
    }
```

---

## Frontend Specification

### Layout

Single page, two panels side by side (md:flex-row, stacked on mobile).

**Left panel — Document Manager**
- Drag-and-drop zone + file picker (accept: .pdf, .docx, .txt)
- Upload button → POST /ingest → show progress spinner
- Ingestion status: "Parsing… Embedding… Done (42 chunks)"
- Document list: filename, chunk count, delete button
- Empty state: "No documents yet. Upload a PDF, DOCX, or TXT to get started."

**Right panel — Voice Query**
- Large centered mic button: idle / recording / processing states
- On stop: POST /voice-query, show loading state
- Transcript: "You said: ..."
- Answer: LLM response text
- Audio player: auto-play TTS (decode audio_base64 → Blob → Audio)
- Sources accordion: collapsible, shows each retrieved chunk with filename + page

### `lib/api.ts`

```typescript
const BASE = "http://localhost:8000"

export const api = {
  ingestDocument: async (file: File) => {
    const fd = new FormData()
    fd.append("file", file)
    return fetch(`${BASE}/ingest`, { method: "POST", body: fd }).then(r => r.json())
  },
  listDocuments: () => fetch(`${BASE}/documents`).then(r => r.json()),
  deleteDocument: (docId: string) =>
    fetch(`${BASE}/documents/${docId}`, { method: "DELETE" }).then(r => r.json()),
  query: (query: string) =>
    fetch(`${BASE}/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query })
    }).then(r => r.json()),
  voiceQuery: async (blob: Blob) => {
    const fd = new FormData()
    fd.append("audio", blob, "recording.webm")
    return fetch(`${BASE}/voice-query`, { method: "POST", body: fd }).then(r => r.json())
  },
}
```

### `VoiceRecorder.tsx`

```typescript
// Detect supported mime type
const mimeType = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4"
// On stop: collect chunks → new Blob([...chunks], {type: mimeType})
// Send blob to api.voiceQuery()
```

### `AudioPlayer.tsx`

```typescript
const playAudio = (base64: string) => {
  const bytes = atob(base64)
  const arr = new Uint8Array(bytes.length).map((_, i) => bytes.charCodeAt(i))
  const blob = new Blob([arr], { type: "audio/wav" })
  const url = URL.createObjectURL(blob)
  new Audio(url).play()
}
```

---

## Setup & Installation

### Prerequisites

---

#### macOS (Apple Silicon or Intel)

```bash
# 1. espeak-ng — required by Kokoro TTS
brew install espeak-ng

# 2. Ollama — install from https://ollama.com, then:
ollama serve
ollama pull llama3.2:3b
ollama pull nomic-embed-text

# 3. Python 3.10+, Node.js 18+
```

---

#### Windows (10 or 11)

**espeak-ng:**
1. Download the `.msi` installer from https://github.com/espeak-ng/espeak-ng/releases (latest release)
2. Run the installer — use the default install path (`C:\Program Files\eSpeak NG\`)
3. Add to PATH manually if the installer doesn't: `C:\Program Files\eSpeak NG\` must be on your system PATH
4. Verify: open a new terminal and run `espeak-ng --version`

**Ollama:**
1. Download from https://ollama.com and run the installer
2. Ollama runs as a background service automatically after install — no need to run `ollama serve` manually
3. Open a terminal and run:
```
ollama pull llama3.2:3b
ollama pull nomic-embed-text
```

**Python 3.10+:** https://python.org — check "Add Python to PATH" during install

**Node.js 18+:** https://nodejs.org

---

### Backend

**macOS:**
```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

**Windows:**
```bat
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

First startup: faster-whisper downloads the Whisper model (~500MB for `small`, ~1.5GB for `medium`), Kokoro downloads TTS weights (~300MB). One-time download, cached locally.

---

### Frontend

```bash
cd frontend
npm install
npm run dev    # localhost:3000
```

Same on both platforms.

---

### `requirements.txt`

```
fastapi
uvicorn[standard]
python-multipart
faster-whisper
chromadb
pymupdf
python-docx
langchain-text-splitters
kokoro
soundfile
numpy
requests
```

**Not included:** `pydub`, `PyAudio`, `sounddevice`, `httpx` — none needed for v1.

---

## Cross-Platform Compatibility Notes

These are the specific places where macOS and Windows diverge. Everything else in the codebase is identical.

| Concern | macOS | Windows |
|---|---|---|
| espeak-ng install | `brew install espeak-ng` | MSI installer from GitHub releases, add to PATH |
| Ollama background service | `ollama serve` (manual) | Runs as Windows service automatically after install |
| venv activation | `source venv/bin/activate` | `venv\Scripts\activate` |
| File path separator | `/` | `\` — use `pathlib.Path` everywhere, never string concat |
| File deletion | `os.remove()` works freely | File must be fully closed first — use `path.unlink(missing_ok=True)` |
| espeak-ng binary name | `espeak-ng` | `espeak-ng.exe` |

**The single biggest Windows gotcha is file handle locking.** Windows holds an exclusive lock on open files. Any route that saves a temp file, processes it, then deletes it must use `try/finally` with `path.unlink()`. If the file is still open when you try to delete it, you get `PermissionError`. This affects `/transcribe`, `/ingest`, and `/voice-query`.

**The README must have separate setup sections for macOS and Windows.** GitHub visitors on Windows will give up immediately if they only see `brew install` commands.

---

## Implementation Order

Build and test each step before moving to the next:

1. **`config.py`** — all constants, no logic
2. **`utils/chunker.py`** — test: `chunk_text("long text...", 100, 20)` returns list of strings
3. **`modules/vector_store.py`** — test: add 3 fake chunks with fake embeddings, query, delete, list
4. **`modules/ingestion.py`** — TXT first → verify chunks land in ChromaDB → add PDF → add DOCX
5. **`modules/asr.py`** — test: `transcribe("sample.wav")` returns string (record any 5-second clip)
6. **`modules/rag.py`** — test: ingest a doc, run `answer_query("what is this about?")`, inspect sources
7. **`modules/tts.py`** — test: `synthesize("hello world")` produces a playable wav file
8. **`main.py`** — wire all routes, test each with curl:
   ```bash
   curl -F "file=@test.pdf" localhost:8000/ingest
   curl -X POST localhost:8000/query -H "Content-Type: application/json" -d '{"query":"summarize"}'
   ```
9. **Frontend** — in order: DocumentUpload → DocumentList → VoiceRecorder → TranscriptPanel → RetrievedChunks → AudioPlayer

---

## v2 Extensions (do not implement now)

- **Image/chart understanding:** `describe_image()` using LLaVA via Ollama. Add to `ingestion.py` behind a config flag `ENABLE_VISION = False`. Only activate when the main LLM is not loaded.
- **LLM response streaming:** stream Ollama tokens → sentence boundary detection → synthesize per sentence → stream audio. Reduces perceived latency significantly.
- **Wake word detection:** always-on mic with a lightweight keyword spotter.
- **Query history:** persist past queries and answers to SQLite.

---

## Key Implementation Notes for Claude Code

1. **All ML routes are sync `def`** — never `async def` for routes calling Whisper, Ollama, or Kokoro. FastAPI's thread pool handles this automatically. This is the single most important correctness rule.

2. **Singletons via module-level globals** — `_model` in `asr.py`, `_pipeline` in `tts.py`. Initialize in `load_model()` / `load_pipeline()` called from the lifespan handler. Never re-initialize per request.

3. **Ollama via direct HTTP requests** — use `requests.post()` to `http://localhost:11434/api/generate` and `/api/embeddings`. Do not install or use the `ollama` Python SDK.

4. **ChromaDB IDs** — use `f"{doc_id}_chunk_{i}"` for each chunk. Use `upsert` not `add` to allow re-ingesting safely.

5. **No ffmpeg subprocess** — faster-whisper decodes audio natively via PyAV. Just pass the raw `.webm` file path. Only add ffmpeg handling if a specific format fails at runtime.

6. **espeak-ng is a hard system dep on both platforms** — install method differs but the check is the same. Add this to `load_pipeline()`:
   ```python
   import shutil, sys
   binary = "espeak-ng" if sys.platform != "win32" else "espeak-ng.exe"
   if not shutil.which(binary):
       platform_hint = (
           "Run: brew install espeak-ng" if sys.platform == "darwin"
           else "Download installer from https://github.com/espeak-ng/espeak-ng/releases and ensure it is on PATH"
       )
       raise RuntimeError(f"espeak-ng not found. {platform_hint}")
   ```

7. **CORS** — `allow_origins=["http://localhost:3000"]` is required. Without it, all browser fetch calls will fail with a CORS error.

8. **Error responses** — every route wraps in try/except and raises `HTTPException(status_code=500, detail=str(e))` on failure. Frontend must handle error states.

9. **Do not install full LangChain** — only `langchain-text-splitters`. Nothing else from the LangChain ecosystem.

10. **Use `pathlib.Path` for all file paths** — never string-concatenate paths with `/` or `\`. `pathlib` is cross-platform and handles separators correctly on both macOS and Windows:
    ```python
    from pathlib import Path
    save_path = Path(config.UPLOAD_DIR) / f"{doc_id}_{filename}"
    ```
    Update `config.py` to use `Path` objects too:
    ```python
    from pathlib import Path
    CHROMA_DB_PATH = str(Path("./chroma_db"))
    UPLOAD_DIR = Path("./uploads")
    ```

11. **Windows-specific: file deletion timing** — on Windows, `os.remove()` on a file that is still open will raise `PermissionError`. Always close file handles explicitly before calling `os.remove()`. Use `try/finally` or context managers. Example in routes:
    ```python
    save_path = Path(config.UPLOAD_DIR) / f"audio_{uuid.uuid4()}.webm"
    try:
        with open(save_path, "wb") as f:
            shutil.copyfileobj(audio.file, f)
        transcript = asr.transcribe(str(save_path))
    finally:
        save_path.unlink(missing_ok=True)   # safe delete, no PermissionError
    ```

---

## What This Project Demonstrates

- End-to-end ML systems design: ASR → retrieval → generation → TTS
- RAG pipeline built from first principles (no LangChain orchestration)
- Local-first / fully private AI: no API keys, no cloud, no data egress
- Production FastAPI patterns: lifespan events, sync routes, singletons
- Full-stack integration: FastAPI + Next.js + Tailwind
- (v2) Multimodal document ingestion with vision models

---

*Platform: macOS (Apple Silicon) + Windows · Stack: faster-whisper · Ollama (llama3.2:3b, nomic-embed-text) · ChromaDB · Kokoro TTS · FastAPI · Next.js 14 · Tailwind CSS*