#!/bin/sh
# Ad-hoc signs the packaged app (identity "-", no notarisation): helper first, then the bundle.
set -e
cd "$(dirname "$0")/.."
APP="release/mac-arm64/Roy Flow.app"
[ -d "$APP" ] || { echo "missing $APP (run electron-builder first)"; exit 1; }
codesign --force --sign - --identifier com.royelia.royflow.helper "$APP/Contents/Resources/RoyFlowHelper"
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP" && echo "signed (ad-hoc): $APP"
