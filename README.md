# VoiceRAG — Local Voice-Powered Document Assistant

Upload documents (PDF, DOCX, TXT) and ask questions about them by voice. Everything
runs locally — ASR, embeddings, the LLM, retrieval, and text-to-speech. No data leaves
your machine, no API keys, no cloud.

**Pipeline:** mic → faster-whisper (ASR) → ChromaDB retrieval → Ollama LLM → Kokoro TTS → spoken answer.

Runs on **macOS (Apple Silicon)** and **Windows** — CPU only, no GPU/CUDA required.

> Image/chart understanding (LLaVA) and token streaming are planned v2 extensions and
> are not part of v1.

---

## Prerequisites

You must install these system dependencies yourself before running the app.

### macOS (Apple Silicon or Intel)

```bash
# 1. espeak-ng — REQUIRED by Kokoro TTS (hard dependency)
brew install espeak-ng

# 2. Ollama — install from https://ollama.com, then start it and pull models:
ollama serve            # leave running in its own terminal
ollama pull llama3.2:3b
ollama pull nomic-embed-text

# 3. uv (Python manager) and Node.js 18+
brew install uv node
```

### Windows (10 / 11)

**espeak-ng (required by Kokoro TTS):**
1. Download the `.msi` from https://github.com/espeak-ng/espeak-ng/releases
2. Install to the default path (`C:\Program Files\eSpeak NG\`)
3. Ensure `C:\Program Files\eSpeak NG\` is on your system PATH
4. Verify in a new terminal: `espeak-ng --version`

**Ollama:**
1. Install from https://ollama.com (runs as a background service automatically)
2. In a terminal:
   ```
   ollama pull llama3.2:3b
   ollama pull nomic-embed-text
   ```

**Other tools:** install [uv](https://docs.astral.sh/uv/) and [Node.js 18+](https://nodejs.org).

---

## Backend

The backend pins **Python 3.12** via uv (`.python-version`). On first startup it
downloads the Whisper model (~500 MB for `small`) and Kokoro TTS weights (~300 MB).
These are one-time, cached locally.

### macOS

```bash
cd backend
uv venv --python 3.12
uv pip install -r requirements.txt
uv run uvicorn main:app --reload --port 8000
```

### Windows

```bat
cd backend
uv venv --python 3.12
uv pip install -r requirements.txt
uv run uvicorn main:app --reload --port 8000
```

Backend serves on `http://localhost:8000`. Make sure `ollama` is running first.

---

## Frontend

```bash
cd frontend
npm install
npm run dev      # http://localhost:3000
```

Open `http://localhost:3000`, upload a document, then click the mic and ask a question.

---

## API

| Method | Route | Purpose |
|---|---|---|
| GET | `/health` | Health check |
| POST | `/ingest` | Upload + ingest a document (multipart `file`) |
| GET | `/documents` | List ingested documents |
| DELETE | `/documents/{doc_id}` | Delete a document and its chunks |
| POST | `/transcribe` | Audio → transcript (multipart `audio`) |
| POST | `/query` | Text query → `{answer, sources}` |
| POST | `/speak` | Text → WAV audio |
| POST | `/voice-query` | Full pipeline: audio → `{transcript, answer, sources, audio_base64}` |

Quick check:

```bash
curl -F "file=@test.pdf" localhost:8000/ingest
curl -X POST localhost:8000/query -H "Content-Type: application/json" -d '{"query":"summarize"}'
```

---

## Notes & gotchas

- **espeak-ng is a hard dependency.** Without it the backend raises a clear error at
  startup with platform-specific install instructions.
- **No ffmpeg step needed** — faster-whisper decodes browser `audio/webm` natively via PyAV.
- **RAM:** designed for 16 GB (M2). Run only one Ollama model at a time; swap
  `LLM_MODEL` to `mistral:7b` in `backend/config.py` for higher quality at more RAM.
- **Windows file locking:** temp uploads are deleted with `Path.unlink(missing_ok=True)`
  in `try/finally` blocks to avoid `PermissionError`.

---

## Config

Tunables live in `backend/config.py`: model names, Whisper size, chunk size/overlap,
`TOP_K_RETRIEVAL`, and paths.
