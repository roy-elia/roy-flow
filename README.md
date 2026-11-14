# Roy Flow

Voice dictation and meeting notes for macOS that run on your Mac.

- **Dictation:** hold a shortcut, speak, and the text is pasted into the app you are using.
- **Notetaker:** transcribes both sides of a call (your microphone and your Mac's sound) into a note with live words.
- **Speech to text on your Mac:** NVIDIA Parakeet on the Neural Engine, with Whisper as a fallback. Your audio is not sent anywhere.
- **Optional cleanup with Claude:** add your own Anthropic API key to tidy up text, run Command Mode and summarise meetings.
- **Flow Bar:** a small capsule at the edge of the screen. Quitting the window keeps the capsule and shortcuts running.

## Requirements

- A Mac with Apple silicon (M1 or later) running macOS 14 Sonoma or later
- Xcode Command Line Tools with Swift 6 (`xcode-select --install`)
- Node.js 20.19 or later, or 22.12 or later (includes npm)
- About 2 GB of free space for the build, plus 632 MB for the speech model

## Install

Clone only the latest version (no history, no other branches), then build and install:

```bash
git clone --depth 1 --single-branch https://github.com/roy-elia/roy-flow.git
cd roy-flow
npm ci
npm run app:build
npm run app:install
open ~/Applications/Roy\ Flow.app
```

The first build takes several minutes, because Swift downloads and compiles the speech engine.
`npm run app:install` copies the app to `~/Applications/Roy Flow.app`. If an older copy is running, it is closed first.

The app is signed ad hoc, not notarised. Because you built it on your own Mac, macOS opens it without a warning.

## First launch

1. **Permissions:** allow these when macOS asks, or turn them on in System Settings › Privacy & Security:
   - **Microphone:** to hear you
   - **Accessibility:** to paste text
   - **Input Monitoring:** for the shortcuts
2. **Speech model:** in Settings, download the Parakeet speech model (632 MB, one time). Until it has finished, Roy Flow uses Whisper.
3. **Claude (optional):** in Settings, paste your Anthropic API key. It is stored encrypted on your Mac and is never written to this repository.

## Update

```bash
cd roy-flow
git pull
npm ci
npm run app:build
npm run app:install
```

## Uninstall

Quit Roy Flow from its menu-bar icon (Quit Roy Flow). Then move `~/Applications/Roy Flow.app` to the Trash.
Your notes, settings and models are in `~/Library/Application Support/Roy Flow`. Delete that folder too if you want them gone.

## Development

```bash
npm run app:dev   # run with live reload
npm test          # unit tests
```
