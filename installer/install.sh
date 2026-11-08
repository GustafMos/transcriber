#!/usr/bin/env bash
# Transcriber installer (macOS / Linux). Asks GPU or CPU, builds whisper.cpp
# from source, downloads the model, then tells you how to run.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT/backend"
BIN_DIR="$BACKEND_DIR/bin"
MODEL_DIR="$ROOT/models"
MODEL="$MODEL_DIR/ggml-small.bin"
MODEL_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin"
SRC_DIR="$BACKEND_DIR/whisper.cpp"

OS="$(uname -s)"
case "$OS" in
  Darwin) PLATFORM="macOS" ;;
  Linux)  PLATFORM="Linux" ;;
  *) echo "Unsupported OS: $OS"; exit 1 ;;
esac

echo "=============================================================="
echo "  Transcriber - local speech-to-text installer ($PLATFORM)"
echo "=============================================================="
echo

# --- GPU or CPU -------------------------------------------------------------
echo "How do you want to run Whisper?"
if [[ "$PLATFORM" == "macOS" ]]; then
  echo "  [1] GPU  - Metal (automatic on Apple Silicon / Intel Macs)"
  echo "  [2] CPU"
else
  echo "  [1] GPU  - CUDA (NVIDIA) or Vulkan (AMD/Intel)"
  echo "  [2] CPU"
fi
read -rp "Choose [1/2] (default 1): " CHOICE
CHOICE="${CHOICE:-1}"

# --- Prerequisites ----------------------------------------------------------
missing=()
command -v cmake >/dev/null 2>&1 || missing+=(cmake)
if [[ "$PLATFORM" == "macOS" ]]; then
  command -v clang++ >/dev/null 2>&1 || missing+=("clang++ (Xcode Command Line Tools)")
else
  command -v g++ >/dev/null 2>&1 || command -v clang++ >/dev/null 2>&1 || missing+=("a C++ compiler")
fi

if [[ ${#missing[@]} -gt 0 ]]; then
  echo
  echo "Missing prerequisites: ${missing[*]}"
  if [[ "$PLATFORM" == "macOS" ]]; then
    echo "Install them with:"
    echo "  xcode-select --install"
    echo "  brew install cmake"
  else
    echo "Install them with (Debian/Ubuntu):"
    echo "  sudo apt install -y build-essential cmake"
    echo "or (Fedora/RHEL):"
    echo "  sudo dnf install -y gcc-c++ cmake"
  fi
  exit 1
fi

mkdir -p "$BIN_DIR" "$MODEL_DIR"

# --- Build whisper.cpp ------------------------------------------------------
echo
echo "Cloning and building whisper.cpp (this takes a few minutes) ..."
if [[ ! -d "$SRC_DIR" ]]; then
  git clone --depth 1 https://github.com/ggml-org/whisper.cpp.git "$SRC_DIR"
fi

CMAKE_ARGS=(-DCMAKE_BUILD_TYPE=Release)
if [[ "$CHOICE" == "1" ]]; then
  if [[ "$PLATFORM" == "macOS" ]]; then
    echo "Metal is detected automatically by whisper.cpp on macOS."
  elif command -v nvcc >/dev/null 2>&1; then
    echo "NVIDIA CUDA detected - building with CUDA."
    CMAKE_ARGS+=(-DGGML_CUDA=ON)
  else
    echo "No CUDA found - building with Vulkan (falling back to CPU if unavailable)."
    CMAKE_ARGS+=(-DGGML_VULKAN=ON)
  fi
fi

cmake -B "$SRC_DIR/build" -S "$SRC_DIR" "${CMAKE_ARGS[@]}"
cmake --build "$SRC_DIR/build" --config Release --target whisper-server -j

# Copy the binary + any shared libs into backend/bin
cp "$SRC_DIR"/build/bin/whisper-server "$BIN_DIR/" 2>/dev/null || true
cp "$SRC_DIR"/build/bin/*.so "$BIN_DIR/" 2>/dev/null || true
cp "$SRC_DIR"/build/bin/*.dylib "$BIN_DIR/" 2>/dev/null || true

if [[ ! -x "$BIN_DIR/whisper-server" ]]; then
  echo "Build succeeded but whisper-server was not found under build/bin." >&2
  exit 1
fi

# --- Model ------------------------------------------------------------------
if [[ ! -f "$MODEL" ]]; then
  echo
  echo "Downloading ggml-small.bin (~466 MB) ..."
  curl -L -o "$MODEL" "$MODEL_URL"
else
  echo "Model already present."
fi

echo
echo "Done! Start the tool with:"
echo "  $ROOT/installer/run.sh"
echo
