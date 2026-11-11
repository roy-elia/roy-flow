#!/bin/sh
# Installs the built app to ~/Applications/Roy Flow.app (never /Applications) and launches it.
set -e
cd "$(dirname "$0")/.."
SRC="release/mac-arm64/Roy Flow.app"
DEST_DIR="$HOME/Applications"
DEST="$DEST_DIR/Roy Flow.app"
[ -d "$SRC" ] || { echo "missing $SRC (run npm run app:build first)"; exit 1; }
mkdir -p "$DEST_DIR"
# quit a running copy so the bundle can be replaced
if pgrep -f "$DEST/Contents/MacOS/Roy Flow" >/dev/null 2>&1; then
  osascript -e 'tell application id "com.royelia.royflow" to quit' >/dev/null 2>&1 || true
  sleep 2
  pkill -f "$DEST/Contents/MacOS/Roy Flow" 2>/dev/null || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do pgrep -f "$DEST/Contents/MacOS/Roy Flow" >/dev/null 2>&1 || break; sleep 0.5; done
fi
rm -rf "$DEST"
ditto "$SRC" "$DEST"
echo "installed: $DEST"
open "$DEST"
