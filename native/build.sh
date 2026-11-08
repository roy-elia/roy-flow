#!/bin/sh
# Builds the native dictation/paste helper into native/build/RoyFlowHelper (arm64, ad-hoc signed by the linker).
set -e
cd "$(dirname "$0")"
mkdir -p build
swiftc -O -target arm64-apple-macos13 \
  -o build/RoyFlowHelper RoyFlowHelper.swift \
  -framework Speech -framework AVFoundation -framework ApplicationServices -framework CoreAudio -framework AppKit -framework EventKit \
  -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker Info.plist
codesign --force --sign - --identifier com.royelia.royflow.helper -r='designated => identifier "com.royelia.royflow.helper"' build/RoyFlowHelper
echo "built native/build/RoyFlowHelper"
