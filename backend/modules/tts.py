import io
import shutil
import sys

import numpy as np
import soundfile as sf

_pipeline = None


def _check_espeak():
    binary = "espeak-ng" if sys.platform != "win32" else "espeak-ng.exe"
    if not shutil.which(binary):
        hint = (
            "Run: brew install espeak-ng"
            if sys.platform == "darwin"
            else "Download the installer from "
            "https://github.com/espeak-ng/espeak-ng/releases and ensure it is on PATH"
        )
        raise RuntimeError(f"espeak-ng not found. {hint}")


def load_pipeline():
    """Called once at startup via lifespan. Downloads ~300MB on first run.
    Requires espeak-ng (see _check_espeak)."""
    global _pipeline
    _check_espeak()
    from kokoro import KPipeline

    _pipeline = KPipeline(lang_code="a")  # 'a' = American English


def synthesize(text: str) -> bytes:
    """Synthesize text to speech. Returns wav bytes."""
    generator = _pipeline(text, voice="af_heart", speed=1.0)
    audio_chunks = [audio for _, _, audio in generator]
    audio_data = np.concatenate(audio_chunks)
    buf = io.BytesIO()
    sf.write(buf, audio_data, samplerate=24000, format="WAV")
    buf.seek(0)
    return buf.read()
