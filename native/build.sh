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
# Parakeet speech engine (SwiftPM, depends on FluidAudio); the first build takes several minutes
(cd parakeet && swift build -c release --product RoyFlowParakeet 2>&1 | tail -1)
cp parakeet/.build/release/RoyFlowParakeet build/RoyFlowParakeet
codesign --force --sign - --identifier com.royelia.royflow.parakeet -r='designated => identifier "com.royelia.royflow.parakeet"' build/RoyFlowParakeet
echo "built native/build/RoyFlowParakeet"
