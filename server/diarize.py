#!/usr/bin/env python3
"""Speaker diarization service for the Transcriber.

POST /diarize  (multipart: file = audio)  ->  {"segments": [{"start": s, "end": s, "speaker": "SPEAKER_00"}, ...]}
GET  /health   ->  {"status": "ok"}

Prerequisites (see README):
  pip install -r requirements.txt
  export HF_TOKEN=...        # HuggingFace token with access to pyannote models
  python server/diarize.py   # listens on http://127.0.0.1:8765
"""
import os
import tempfile

from flask import Flask, jsonify, request

app = Flask(__name__)

PORT = int(os.environ.get("DIARIZE_PORT", "8765"))
MODEL = os.environ.get("DIARIZE_MODEL", "pyannote/speaker-diarization-3.1")
_pipeline = None


def get_pipeline():
    global _pipeline
    if _pipeline is None:
        from pyannote.audio import Pipeline

        kwargs = {}
        token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_TOKEN")
        if token:
            kwargs["token"] = token
        _pipeline = Pipeline.from_pretrained(MODEL, **kwargs)

        # Move to GPU when available.
        try:
            import torch

            if torch.cuda.is_available():
                _pipeline = _pipeline.to(torch.device("cuda"))
        except Exception:
            pass
    return _pipeline


@app.after_request
def cors(resp):
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Headers"] = "content-type"
    return resp


@app.get("/health")
def health():
    return jsonify({"status": "ok"})


@app.post("/diarize")
def diarize():
    if "file" not in request.files:
        return jsonify({"error": "missing 'file' field"}), 400
    f = request.files["file"]
    suffix = os.path.splitext(f.filename or "audio.wav")[1] or ".wav"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        f.save(tmp.name)
        path = tmp.name

    try:
        diarization = get_pipeline()(path)
        segments = [
            {"start": round(turn.start, 3), "end": round(turn.end, 3), "speaker": label}
            for turn, _, label in diarization.itertracks(yield_label=True)
        ]
        return jsonify({"segments": segments})
    except Exception as e:  # surface a readable error to the caller
        return jsonify({"error": str(e)}), 500
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=PORT)
