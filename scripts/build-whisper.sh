#!/usr/bin/env bash
# Rebuilds vendor/whisper/whisper-server (whisper.cpp's HTTP server, Metal + Core ML, static, arm64).
# The committed binary was built with this recipe (whisper.cpp v1.9.5) for RoyFlow and thinned to arm64.
# Core ML: if <model>-encoder.mlmodelc sits next to the .bin, the encoder runs on the Neural Engine;
# otherwise whisper-server falls back to Metal. Shaders are embedded, so the binary ships alone.
set -euo pipefail
TAG="${WHISPER_TAG:-v1.9.5}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${WHISPER_SRC:-${TMPDIR:-/tmp}/whisper.cpp-$TAG}"
[ -d "$SRC/.git" ] || git clone --depth 1 --branch "$TAG" https://github.com/ggml-org/whisper.cpp.git "$SRC"
cmake -S "$SRC" -B "$SRC/build" \
  -DCMAKE_BUILD_TYPE=Release -DCMAKE_OSX_ARCHITECTURES=arm64 -DCMAKE_OSX_DEPLOYMENT_TARGET=13.3 \
  -DBUILD_SHARED_LIBS=OFF -DGGML_METAL=ON -DGGML_METAL_EMBED_LIBRARY=ON -DGGML_NATIVE=OFF \
  -DWHISPER_COREML=ON -DWHISPER_COREML_ALLOW_FALLBACK=ON \
  -DWHISPER_BUILD_EXAMPLES=ON -DWHISPER_BUILD_TESTS=OFF -DWHISPER_SDL2=OFF
cmake --build "$SRC/build" --config Release -j --target whisper-server
mkdir -p "$ROOT/vendor/whisper"
cp "$SRC/build/bin/whisper-server" "$ROOT/vendor/whisper/whisper-server"
echo "built vendor/whisper/whisper-server"
