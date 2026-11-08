# Transcriber

A self-contained, **browser-based speech-to-text tool** that runs entirely on your machine using [whisper.cpp](https://github.com/ggml-org/whisper.cpp). No cloud, no account, no data ever leaves your computer.

- 🎙️ **Live transcription** — capture the microphone and get text as you speak.
- 📁 **Transcribe recordings** — upload an existing audio/video file (mp3, m4a, wav, ogg, flac, …).
- 👥 **Speaker tags** — label who is talking, edit anything after the fact.
- 💾 **Auto-saves locally** — transcripts are kept in your browser with a history list, plus copy / export `.md` / export `.txt`.

## Requirements

| Platform | What you need |
| --- | --- |
| **Windows** | Nothing special — the installer downloads a prebuilt backend. (GPU option needs an NVIDIA GPU + driver.) |
| **macOS** | Xcode Command Line Tools + CMake (the installer builds with **Metal**). |
| **Linux** | A C++ compiler + CMake (the installer builds it; GPU option uses CUDA/Vulkan). |

## Install

Run the installer for your platform — it asks **GPU or CPU**, then downloads/builds the backend and the model (multilingual `ggml-small`, ~466 MB).

**Windows** — double-click `installer\install.bat` (or):

```bat
installer\install.bat
```

**macOS / Linux**:

```sh
chmod +x installer/install.sh
./installer/install.sh
```

## Run

**Windows** — double-click `installer\run.bat` (or `installer\run.bat` from a terminal).

**macOS / Linux**:

```sh
./installer/run.sh
```

Your browser opens to `http://127.0.0.1:8000`. Close the run window to stop everything.

## How it works

```
browser (Transcriber UI)  ──http──▶  whisper-server (127.0.0.1:8080)
        │                                     │
        └── mic / file audio → WAV chunks ────┘
```

- `index.html` + `css/` + `js/` is a static single-page app with no dependencies.
- The installer puts a `whisper-server` binary in `backend/bin/` and the model in `models/` (both git-ignored).
- Audio is captured in the browser, resampled to 16 kHz mono WAV, and posted to the local whisper server, which returns the text.

Everything runs locally — the audio never leaves your machine.

## Choosing a model

The default is the multilingual `ggml-small.bin`. You can swap it for another whisper.cpp model in `models/` and update `installer/run.sh` / `run.bat` (the `MODEL` path):

| Model | Size | Notes |
| --- | --- | --- |
| `ggml-tiny.bin` | ~75 MB | Fastest, lowest accuracy |
| `ggml-base.bin` | ~142 MB | Fast, moderate accuracy |
| `ggml-small.bin` | ~466 MB | **Default** — good balance |
| `ggml-medium.bin` | ~1.5 GB | More accurate, slower |
| `ggml-large-v3.bin` | ~2.9 GB | Best accuracy, needs lots of RAM/VRAM |

English-only variants (`ggml-small.en.bin`, etc.) are smaller/faster for English audio. Download them from <https://huggingface.co/ggerganov/whisper.cpp>.

## Notes & limitations

- The microphone requires the app to be served over `http://localhost` (a secure context) — that's why the run scripts start a tiny local web server. Opening `index.html` directly from disk won't allow mic access.
- The backend is **whisper.cpp**; GPU backends are Metal (macOS), CUDA (NVIDIA), and Vulkan (AMD/Intel), with CPU as a universal fallback.
- Transcripts live in your browser's `localStorage` — clear your browser data to wipe them.
- The Windows installer downloads prebuilt binaries from the whisper.cpp nightly builds; macOS/Linux build from source.
