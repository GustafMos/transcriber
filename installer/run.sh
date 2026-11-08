#!/usr/bin/env bash
# Start the Transcriber: whisper server + web UI + browser.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER="$ROOT/backend/bin/whisper-server"
MODEL="$ROOT/models/ggml-small.bin"

if [[ ! -x "$SERVER" ]]; then
  echo "Backend not installed. Run installer/install.sh first." >&2
  exit 1
fi
if [[ ! -f "$MODEL" ]]; then
  echo "Model not found. Run installer/install.sh first." >&2
  exit 1
fi

echo "Starting Whisper server on 127.0.0.1:8080 ..."
"$SERVER" -m "$MODEL" --host 127.0.0.1 --port 8080 &
WHISPER_PID=$!
trap 'kill "$WHISPER_PID" 2>/dev/null || true' EXIT

echo "Starting web UI at http://127.0.0.1:8000 (Ctrl+C to stop)"
if command -v python3 >/dev/null 2>&1; then
  UI="python3 $ROOT/server/serve.py"
elif command -v python >/dev/null 2>&1; then
  UI="python $ROOT/server/serve.py"
else
  echo "Python 3 is required to serve the web UI. Install it and re-run." >&2
  exit 1
fi

( sleep 1; (command -v open >/dev/null 2>&1 && open "http://127.0.0.1:8000") || (command -v xdg-open >/dev/null 2>&1 && xdg-open "http://127.0.0.1:8000") ) &
eval "$UI"
