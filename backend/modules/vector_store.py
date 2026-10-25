import chromadb

import config

_client = None
_collection = None


def get_collection():
    """Initialize once, return persistent collection 'voicerag'."""
    global _client, _collection
    if _collection is None:
        _client = chromadb.PersistentClient(path=config.CHROMA_DB_PATH)
        _collection = _client.get_or_create_collection("voicerag")
    return _collection


def add_chunks(
    chunks: list[str],
    embeddings: list[list[float]],
    metadatas: list[dict],
    ids: list[str],
):
    """Upsert chunks. IDs format: '{doc_id}_chunk_{i}'."""
    if not chunks:
        return
    get_collection().upsert(
        documents=chunks,
        embeddings=embeddings,
        metadatas=metadatas,
        ids=ids,
    )


def query(
    query_embedding: list[float], top_k: int = 4, chat_id: str | None = None
) -> list[dict]:
    """Returns list of {text, metadata, distance}, scoped to chat_id when given."""
    kwargs = {"query_embeddings": [query_embedding], "n_results": top_k}
    if chat_id is not None:
        kwargs["where"] = {"chat_id": chat_id}
    results = get_collection().query(**kwargs)
    if not results["ids"] or not results["ids"][0]:
        return []
    return [
        {"text": doc, "metadata": meta, "distance": dist}
        for doc, meta, dist in zip(
            results["documents"][0],
            results["metadatas"][0],
            results["distances"][0],
        )
    ]


def delete_document(doc_id: str):
    """Delete all chunks with metadata.doc_id == doc_id."""
    get_collection().delete(where={"doc_id": doc_id})


def delete_chat_chunks(chat_id: str):
    """Delete all chunks belonging to a chat — used when the chat is deleted."""
    get_collection().delete(where={"chat_id": chat_id})


def list_documents(chat_id: str | None = None) -> list[dict]:
    """Return unique docs as [{doc_id, filename, chunk_count}], scoped to chat_id when given."""
    kwargs = {"include": ["metadatas"]}
    if chat_id is not None:
        kwargs["where"] = {"chat_id": chat_id}
    data = get_collection().get(**kwargs)
    docs: dict[str, dict] = {}
    for meta in data["metadatas"]:
        doc_id = meta["doc_id"]
        if doc_id not in docs:
            docs[doc_id] = {
                "doc_id": doc_id,
                "filename": meta.get("filename", ""),
                "chunk_count": 0,
            }
        docs[doc_id]["chunk_count"] += 1
    return list(docs.values())


def migrate_orphan_chunks(default_chat_id: str) -> int:
    """Reassign chunks that have no chat_id (pre-chat schema) to default_chat_id.
    Returns the number of chunks migrated."""
    coll = get_collection()
    data = coll.get(include=["metadatas", "documents", "embeddings"])
    ids = data["ids"]
    if not ids:
        return 0

    orphan_ids = []
    orphan_docs = []
    orphan_embs = []
    orphan_metas = []
    for i, meta in enumerate(data["metadatas"]):
        if "chat_id" not in meta:
            new_meta = dict(meta)
            new_meta["chat_id"] = default_chat_id
            orphan_ids.append(ids[i])
            orphan_docs.append(data["documents"][i])
            orphan_embs.append(data["embeddings"][i])
            orphan_metas.append(new_meta)

    if orphan_ids:
        coll.upsert(
            ids=orphan_ids,
            documents=orphan_docs,
            embeddings=orphan_embs,
            metadatas=orphan_metas,
        )
    return len(orphan_ids)
