from faster_whisper import WhisperModel

import config

_model = None


def load_model():
    """Called once at startup via lifespan."""
    global _model
    _model = WhisperModel(
        config.WHISPER_MODEL,
        device=config.WHISPER_DEVICE,
        compute_type=config.WHISPER_COMPUTE_TYPE,
    )


def transcribe(audio_path: str) -> str:
    """Transcribe audio file, return full transcript string."""
    segments, _ = _model.transcribe(audio_path, beam_size=2, vad_filter=True)
    return " ".join(segment.text.strip() for segment in segments).strip()
