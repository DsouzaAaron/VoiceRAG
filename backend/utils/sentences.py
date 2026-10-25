import re
from collections.abc import Iterator

# A sentence ends at . ! ? (optionally followed by a closing quote/bracket),
# then whitespace. Flush early once the buffer gets long so a single very long
# sentence doesn't delay the first audio chunk.
_BOUNDARY = re.compile(r'[.!?]["\')\]]?\s')
_MAX_CHARS = 200


def iter_sentences(tokens: Iterator[str]) -> Iterator[str]:
    """Buffer streamed tokens and yield complete sentences as they form.

    Flushes on a sentence-ending boundary, or once the buffer exceeds
    _MAX_CHARS (split at the last whitespace to avoid cutting a word).
    Any trailing text is yielded at the end.
    """
    buffer = ""
    for token in tokens:
        buffer += token

        # Flush every completed sentence currently in the buffer, in order.
        while True:
            match = _BOUNDARY.search(buffer)
            if match is None:
                break
            cut = match.end()
            sentence = buffer[:cut].strip()
            buffer = buffer[cut:]
            if sentence:
                yield sentence

        # Long-buffer fallback: emit a clause so first audio isn't delayed.
        if len(buffer) >= _MAX_CHARS:
            split_at = buffer.rfind(" ", 0, _MAX_CHARS)
            if split_at <= 0:
                split_at = _MAX_CHARS
            sentence = buffer[:split_at].strip()
            buffer = buffer[split_at:]
            if sentence:
                yield sentence

    tail = buffer.strip()
    if tail:
        yield tail
