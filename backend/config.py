from pathlib import Path

OLLAMA_BASE_URL = "http://localhost:11434"
LLM_MODEL = "llama3.2:3b"           # fast on M2; swap to mistral:7b for quality
EMBED_MODEL = "nomic-embed-text"
WHISPER_MODEL = "small"             # "medium" if latency is acceptable
WHISPER_DEVICE = "cpu"
WHISPER_COMPUTE_TYPE = "int8"
CHROMA_DB_PATH = str(Path("./chroma_db"))
CHAT_DB_PATH = Path("./chats.db")
UPLOAD_DIR = Path("./uploads")
CHUNK_SIZE = 500
CHUNK_OVERLAP = 50
TOP_K_RETRIEVAL = 4

# v2 only — do not use in v1
# VISION_MODEL = "llava:7b"
