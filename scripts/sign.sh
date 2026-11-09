#!/bin/sh
# Ad-hoc signs the packaged app (identity "-", no notarisation): helper and whisper-server first, then the bundle.
# Ad-hoc signatures normally pin macOS privacy grants (Accessibility, Input Monitoring, Microphone) to the exact
# build (designated requirement = cdhash), so every rebuild lost them. An explicit designated requirement on the
# bundle identifier keeps the grants across rebuilds.
set -e
cd "$(dirname "$0")/.."
APP="release/mac-arm64/Roy Flow.app"
[ -d "$APP" ] || { echo "missing $APP (run electron-builder first)"; exit 1; }
codesign --force --sign - --identifier com.royelia.royflow.helper \
  -r='designated => identifier "com.royelia.royflow.helper"' "$APP/Contents/Resources/RoyFlowHelper"
# nested Mach-O executables must be signed before the bundle that contains them
WHISPER="$APP/Contents/Resources/whisper/whisper-server"
[ -f "$WHISPER" ] || { echo "missing $WHISPER"; exit 1; }
codesign --force --sign - --identifier com.royelia.royflow.whisper \
  -r='designated => identifier "com.royelia.royflow.whisper"' "$WHISPER"
codesign --force --deep --sign - "$APP"
# re-sign the outer bundle only (not --deep, nested frameworks keep their own identifiers)
codesign --force --sign - --identifier com.royelia.royflow -r='designated => identifier "com.royelia.royflow"' "$APP"
codesign --verify --deep --strict "$APP" && echo "signed (ad-hoc, stable requirement): $APP"
