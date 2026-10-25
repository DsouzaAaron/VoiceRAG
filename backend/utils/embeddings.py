import requests

import config


def embed_text(text: str) -> list[float]:
    """Embed a single string via Ollama nomic-embed-text (POST /api/embed)."""
    resp = requests.post(
        f"{config.OLLAMA_BASE_URL}/api/embed",
        json={"model": config.EMBED_MODEL, "input": text},
        timeout=60,
    )
    resp.raise_for_status()
    return resp.json()["embeddings"][0]
