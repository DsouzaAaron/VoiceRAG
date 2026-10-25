from collections.abc import Iterator

import requests

import config
from modules import chat_store, vector_store
from utils.embeddings import embed_text

HISTORY_TURNS = 4
HISTORY_MAX_CHARS = 1500


def retrieve(query_text: str, chat_id: str) -> tuple[list[dict], str]:
    """Embed the query, search ChromaDB scoped to chat_id, build the prompt with history.
    Returns (sources, prompt) — shared by the text and streaming paths."""
    query_embedding = embed_text(query_text)
    chunks = vector_store.query(
        query_embedding, top_k=config.TOP_K_RETRIEVAL, chat_id=chat_id
    )
    history = chat_store.last_n_turns(chat_id, HISTORY_TURNS)
    prompt = build_prompt(query_text, [c["text"] for c in chunks], history)
    return chunks, prompt


def answer_query(query_text: str, chat_id: str) -> dict:
    """Full RAG pipeline. Returns {answer, sources}."""
    chunks, prompt = retrieve(query_text, chat_id)
    answer = call_ollama_llm(prompt)
    return {"answer": answer, "sources": chunks}


def _format_history(history: list[dict]) -> str:
    """Format last-N turns as plain transcript, oldest-first, char-capped."""
    if not history:
        return ""
    lines = []
    for msg in history:
        prefix = "User" if msg["role"] == "user" else "Assistant"
        lines.append(f"{prefix}: {msg['content']}")
    text = "\n".join(lines)
    if len(text) > HISTORY_MAX_CHARS:
        text = text[-HISTORY_MAX_CHARS:]
        cut = text.find("\n")
        if cut != -1:
            text = text[cut + 1 :]
    return text


def build_prompt(
    query: str, context_chunks: list[str], history: list[dict] | None = None
) -> str:
    context = (
        "\n\n---\n\n".join(context_chunks) if context_chunks else "(no documents found)"
    )
    history_block = ""
    history_text = _format_history(history or [])
    if history_text:
        history_block = (
            "Prior conversation (for follow-up context):\n"
            f"{history_text}\n\n"
        )
    return f"""You are a helpful assistant. Answer the question using only the context below.
If the answer is not in the context, say "I don't have enough information to answer that."
Do not make up information. Answer concisely in 2–3 sentences.

{history_block}Context:
{context}

Question: {query}

Answer:"""


def call_ollama_llm(prompt: str) -> str:
    """POST to Ollama /api/generate, stream=False, return response string."""
    resp = requests.post(
        f"{config.OLLAMA_BASE_URL}/api/generate",
        json={"model": config.LLM_MODEL, "prompt": prompt, "stream": False},
        timeout=120,
    )
    resp.raise_for_status()
    return resp.json()["response"].strip()


def stream_llm(prompt: str) -> Iterator[str]:
    """POST to Ollama /api/generate with stream=True, yield response token deltas."""
    import json

    with requests.post(
        f"{config.OLLAMA_BASE_URL}/api/generate",
        json={"model": config.LLM_MODEL, "prompt": prompt, "stream": True},
        timeout=120,
        stream=True,
    ) as resp:
        resp.raise_for_status()
        for line in resp.iter_lines():
            if not line:
                continue
            payload = json.loads(line)
            token = payload.get("response", "")
            if token:
                yield token
            if payload.get("done"):
                break
