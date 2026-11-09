# Roy Flow 1.2: QA checklist

Quality pass on 1.1. Wispr Flow behaviour is taken from `analysis/wispr-flow/` (REPORT.md App. A §2-3,
UI_PAGES_ADDENDUM_2.md §3, UI_FLOWBAR.md, HELPER_DEEP_DIVE.md).

Status key: **works** (real effect, persisted), **partial**, **fake** (looks like it does something but does not),
**broken**. "Before" is 1.1; "Now" is 1.2. Hidden = removed from the UI because it cannot work in a local app.

## Totals

Every control on every page, the 10 Settings tabs, the Flow Bar, the tray and the app menu was audited (tables below).
Controls not listed as partial or fake already worked in 1.1 (read from the code) and were left as they were.

| 1.1 status | Count | Outcome in 1.2 |
|---|---|---|
| partial | 17 | 14 now work fully, 2 hidden (team sharing, tutorial), 1 relabelled honestly (Help "Save as text file") |
| fake | 13 | 3 now work (bell, flag note, info buttons kept as explanations), 7 hidden or replaced by a real feature, 3 relabelled (version label ×2, "Coming soon" connectors kept disabled) |
| broken (UI) | 0 | – |
| behaviour bugs | 3 | fixed (below) |

Behaviour bugs found and fixed (no UI control involved):
1. **Stale key blocked fn forever.** If any key-up was missed (secure input field, tap timeout), the helper kept that key
   in its "pressed" list and refused to start any modifier-only hold, so fn push-to-talk silently stopped working
   until the helper restarted. Now every event reconciles against the real key state, a missed fn-up is corrected from the
   next key event's flags, and a 200 ms watchdog (only while a hold is active) releases a hold whose keys are up for 3 ticks.
2. **Every rebuild lost the macOS permissions.** Ad-hoc signing pinned the Accessibility / Input Monitoring / Microphone
   grants to the build's cdhash. The bundle and helper now carry an explicit designated requirement on their identifier
   (`scripts/sign.sh`, `native/build.sh`), so grants survive rebuilds. One more grant is needed after this install.
3. **History depended on the hub window.** Dictations, meeting notes and summaries were saved by the hub renderer
   (`store:mutate`), so the hub could never be closed. Main now owns all writes (`applyMutation` in `src/shared/state.ts`)
   and creates the data file itself on first run.

## Dictation pipeline (end to end)

| Flow | Wispr behaviour | Before | Now |
|---|---|---|---|
| Hold fn (push to talk) | hold = record, release = paste | works | works; mic engine kept prepared (`warm`), start latency logged as `[dictation] mic started {ms}` |
| Tap fn < 350 ms | ignored; double tap = hands-free | works | works |
| ⌥Space hands-free | press to start, press again (or tap PTT) to paste | works | works |
| Live level on the pill | level every ~150 ms | works (50 ms) | works (60 ms, only while recording) |
| Release → processing → paste at cursor | clipboard + ⌘V, clipboard restored | works | works; ⌘V posted with 5 ms down/up gap like Wispr |
| Added to history | yes | works only with hub alive | works with the hub closed |
| Esc cancels | dismiss | works (lost the text) | works; after >1 s of speech the Flow Bar shows "Dictation cancelled · **Undo**" for 6 s, Undo pastes it |
| Short / empty recording | dropped | error pill "No speech detected" | dropped silently (<400 ms or no words), audio file deleted |
| Stale key protection | `CheckStaleKeys` | missing | works (see bug 1; covered by `--selftest`) |
| Mic warm-up | n/a | new AVAudioEngine + recognizer per start | engine per device cached and `prepare()`d, recognizer cached, rebuilt on device change; mic only open while recording |
| Mute while dictating | mute output | works | works |

## Accuracy and formatting

| Item | Before | Now |
|---|---|---|
| Dictionary replacements | partial: `\b` failed on C++/.NET, no longest-first | works (Unicode word edges, longest first) |
| Snippets (spoken trigger) | works | works; also `{name} {first} {last} {email} {date} {time}` placeholders |
| Rule clean-up (no key) | partial: removed "you know"/"like" inside real sentences ("do you know him" → "do him") | works: hesitations, comma-set fillers, stutters (keeps "that that"), "new line"/"new paragraph", spacing, capitals, final stop |
| Claude Haiku clean-up | works (9 s timeout) | works (6 s timeout, falls back to rules) |
| Per-app Style | partial: casual/very casual deleted every full stop and merged sentences | works: casual drops only the final stop, very casual lowercases |
| Code editors | none | **new** Code-aware dictation (Settings › Vibe coding): no forced capitals/full stop in editors and terminals |
| Undo AI edit / Retry | works | works (Retry no longer overwrites the live target app) |

## Transforms, Notetaker, calendar

| Item | Before | Now |
|---|---|---|
| ⌥1 / ⌥2 on selected text, last dictation fallback | works | works |
| Auto Apply after dictation | works | works |
| ⌥O before/after view | works | works |
| "How it works", view-changes chip | info toasts | works (they explain; nothing pretends to act) |
| Notetaker start/stop, live transcript, max length, stop on silence | works | works; meeting saved by main |
| Summary, retry, Ask | works | works |
| Upcoming meetings (EventKit) | works | works; tray item starts Notetaker for a meeting within 10 min |
| Tray "Past notes" item | partial: opened the page | works: opens that note |
| "Shared with me" tab | fake | hidden |
| Connect calendar | partial (always set the Google flag) | works (both flags read the same macOS calendar; label unchanged) |

## Hub pages

| Control | Before | Now |
|---|---|---|
| Home: flag + note | partial / fake note | works: note saved (`flagNote`), shown in the tooltip, search "flagged" lists them |
| Home: all other controls (14) | works | works |
| Dictionary/Snippets: Sync | fake (spinner) | hidden |
| Dictionary/Snippets: "Shared with team" tab, row toggles, modal checkboxes | partial (filter only) | hidden (no team in a local app) |
| My Voice menu: Add a word / Create snippet | partial (page only) | works: opens the Add dialog |
| Scratchpad: Refresh | fake (spinner) | hidden |
| Title bar bell | fake (hard-coded "2 day streak") | works: real streak, words, notes without summary |
| Sidebar checklist | partial (ticked on click) | works: ticked when done (dictated into an app, recorded a note, calendar connected, MCP page visited) |
| Checklist "Import past meetings" | fake | replaced by "Dictate into another app" |
| Sidebar "Invite your team" | fake | hidden |
| Help modal "Send message" | partial (saved a txt) | relabelled honestly: "Help and feedback", "Save as text file" |

## Settings modal (10 tabs)

| Tab | Before | Now |
|---|---|---|
| General: shortcuts ×2, microphone, languages, theme | works | works; mic/language change re-warms the helper |
| System: 11 toggles, test notification, reset | works | works |
| System: Scratchpad open behaviour | partial | works (standalone window reads it) |
| System: "Auto Cleanup" link | partial (wrong tab) | works (opens Style › Auto cleanup) |
| Notetaker: 6 settings, shortcut | works | works |
| Notetaker: Start tutorial | fake | hidden |
| Notetaker: hide Flow Bar in capture | partial (label said "while Notetaker is active") | works, label says it applies always |
| Vibe coding: variable recognition "Set up", File Tagging, Learn more ×2 | fake | replaced by the real Code-aware dictation toggle |
| Connectors: calendars | works | works |
| Connectors: Slack/Gmail/Notion | disabled "Coming soon" | unchanged (honestly labelled) |
| MCP: Add to Claude, copy command/URL | works | works |
| Account: name, Claude key save/test/remove, Claude clean-up | works | works |
| Account: email | partial (unused) | works: snippets insert it with `{email}` |
| Team | placeholder text | unchanged (says it is not available) |
| Billing | information | unchanged |
| Data and Privacy: context awareness, export, delete, demo data | works | works |
| Data and Privacy: "Auto-delete after 30 days" | partial (only at hub launch) | works: main applies it at start and every 6 h |
| Sidebar version "Up to date" button | fake | plain "Local build" label |
| Dead defaults (`detectCalls`, `notepadView`, `calendarNotice`, …, 12 keys) | unused | removed from the seed |

## Flow Bar, tray, app menu

| Item | Before | Now |
|---|---|---|
| Pill states (resting, ready, recording, processing, error) | works | works |
| Pill buttons: dictate, cancel, finish, Notetaker, Scratchpad, Transforms | works | works |
| Notes | works | works, can carry an action (Undo) |
| Tray/app "Check for updates" | fake (static dialog) | replaced by a disabled "Version 1.2.0 (local build)" item |
| Tray/app Help center + Talk to support + Share feedback | partial (3 items, one dialog) | one "Help and feedback…" item |
| Help › Log Resource Usage | none | **new**: `app.getAppMetrics()` to a dialog, `main.log` and `metrics.json` (also `kill -USR2 <pid>`) |
| Everything else (Start dictation/Notetaker, Scratchpad, paste/copy last, microphone, languages, Quit…) | works | works |

## Shortcuts editor (live recording)

| Behaviour (Wispr §3.3) | Before | Now |
|---|---|---|
| Live chips while held, including fn | works | works |
| Commit | on release of all keys | immediately on a non-modifier key or mouse button; modifier-only chords on release |
| Esc cancels, Backspace clears | works | works; the last Push-to-talk / Cancel shortcut cannot be cleared (no trash icon, as in Wispr) |
| Global matching paused while recording | works | works; record mode also ends after 20 s, when the hub closes, reloads or crashes (could leave every hotkey dead) |
| Mouse buttons 3/4/5 | missing | works (event tap reports `otherMouseDown`; DOM fallback when no tap); context menu suppressed while recording |
| Validation | 4 keys, short blocked list | Wispr rules: ≤3 keys, one non-modifier, modifier or mouse button required, ⇧+letter refused, ⌘C/V/X/Z/R/A/F/G/H/M/N/O/P/S/T/W/Q/,, ⌘Space, ⌘Tab… refused with "This shortcut is not allowed", "already in use by …" |
| Soft warnings | PTT ⊂ hands-free | also ⌃Space, ⌃⌥Space, ⌃↑/↓/←/→, ⌥⌘Space (macOS defaults you can turn off) |
| Up to 4 shortcuts per action | 3 | 4 |
| Applies at once in the helper | works | works |

## Lightweight

Changes: the hub window is destroyed when closed and recreated on demand (state lives in main); pages and
dialogs other than Home are lazy-loaded; no infinite CSS animation on idle pages (`coach` pulses 4 times, the share ring
spins only on hover, reduced-motion respected); the renderer's 4 s permission poll is gone (main pushes changes) and main
polls every 5 s only while the hub is visible or the tap is not active, otherwise every 60 s; the Flow Bar page no longer
loads the hub's base/pages CSS, and its window shrinks from 620×380 to 300×110 while only the pill shows; the helper's
watchdog timer runs only during a hold.

Also: the Anthropic SDK (1.3 MB of the 1.4 MB main bundle) is now a separate `anthropic.cjs` loaded on the first Claude
call. Permission-poll results are no longer written to `main.log` every 5 s (only changes are).

Measured with `ps -o %cpu,rss` every second for 30 s (sum of all Roy Flow processes incl. the Swift helper),
both builds installed at the same path and measured the same way after a fresh launch. The brief's 254 MB baseline came
from an app that had run for hours (macOS had compressed its memory); fresh-launch numbers are higher for both builds,
so compare the columns with each other, not with 254 MB.

| Scenario | 1.1 | 1.2 |
|---|---|---|
| Idle, hub open on screen but unfocused, Home page (launch + 90 s) | **20.2 % CPU** (steady; the infinite "Start now" pulse), 567 MB, 6 processes | 0.27 % CPU, 563 MB *(see note)* |
| Idle, hub closed (1.1: hidden; 1.2: destroyed / never created) | 0.10 % CPU, 575 MB, 6 processes | **0.03 % CPU, 347 MB, 5 processes** (main 142, GPU 63, network 41, Flow Bar 82, helper 17) |
| During dictation | not measurable here | not measurable here (microphone permission must be granted again, see below) |

Note: for the 1.2 hub-open run the window ended up on another Space (the screen was in a full-screen app), so that CPU
figure is not a fair visible-window measurement; the cause of 1.1's 20 % (an `infinite` CSS animation on Home) is
gone in the code. Use Help › Log Resource Usage to see the live numbers any time.

## Tests

- `npm test` (vitest): 54 tests: text pipeline (clean-up, styles, dictionary, snippets, diff), hotkey validation
  and labels, state merge/migration, mutations, retention.
- `npm run test:native`: builds the helper and runs `RoyFlowHelper --selftest`: 14 checks of the key matcher with
  synthetic events (fn hold/abort, ⌥Space, contextual Esc, ⌃⌘V, mouse 4, missed key-up, watchdog release and keep,
  stale fn from flags, recording mode).

## Verified live / not verified

Verified in the installed app (background computer use on Roy Flow only):
- App launches, data loads, checklist shows "Dictate into another app" ticked from real history; Accessibility banner shows.
- Settings opens (lazy-loaded); General › Shortcuts › Change opens the editor; "Add" puts a field in recording
  state with the live placeholder; a modifier-only press on Hands-free was refused with the Wispr-style inline error
  and toast and nothing was saved; Close works.
- Closing the hub removes its renderer (6 → 5 processes); the Flow Bar panel is now 300×110 at rest.
- Help › Log Resource Usage / `kill -USR2` writes `[metrics]` to `main.log` and `metrics.json`.
- `--selftest` (14 checks) and `npm test` (54) pass; typecheck, build, native, app:build, app:install all succeed.

Not verified live (and why):
- A full chord recording through the event tap, fn push-to-talk, ⌥Space, Esc + Undo, paste and the mic warm-start
  latency: after reinstalling, macOS no longer trusts the new build (the old grants were pinned to the old cdhash), so
  the event tap is off and the microphone is denied; background key presses also cannot deliver arbitrary chords.
  The matcher is covered by `--selftest`, the pipeline by vitest.

## Needs you

- **Grant permissions once more** (System Settings › Privacy & Security): Accessibility and Input Monitoring for
  Roy Flow (remove the old entry first if it is listed), and Microphone / Speech Recognition when macOS asks. Thanks
  to the new signing requirement these should now survive future rebuilds.
- An Anthropic API key (Settings › Account) for Claude clean-up, Transforms, summaries and Ask; without it the rule-based
  path is used.

## Remaining gaps

- Left/right-specific modifiers (Wispr's "left_right_same" rule) are not distinguished; ⌥ means either ⌥.
- No AX read-back that the paste landed (Wispr's `DictatedTextVerification`), no "click a text box" hint.
- Speaker labels, meeting import, team sharing and cloud sync do not exist in the local app (hidden).

## 1.3 + RoyFlow merge (branch `claude/royflow-merge`)

RoyFlow (`~/Downloads/dictation-overlay`) is retired; its engine and unique features now live here. Its own
settings window, pill and UI were not ported.

| Feature | Where | Notes |
|---|---|---|
| Speech engine: **Whisper** (default) or Apple Speech | Settings › General › Speech engine | Whisper: the helper records only (`start` with `"engine":"whisper"`, no SFSpeechRecognizer), main converts the WAV to 16 kHz mono Int16 (`electron/wav.ts`) and posts it to a managed `whisper-server` (`electron/whisper.ts`) with the dictionary as a `Glossary:` prompt; the text then goes through the unchanged pipeline (clean-up, style, dictionary, snippets, Claude, paste, history, stats). History items carry `speech: 'whisper' \| 'apple'`. No live text while recording with Whisper. |
| Fallback to Apple Speech | automatic | while the model is missing/downloading, during the one-time Core ML compile ("Preparing speech model…" on the Flow Bar), or after the server failed to start; a note says why (at most every 10 min). |
| Models | `~/Library/Application Support/Roy Flow/models` | moved (rename, no copy) from `…/RoyFlow/models` on first run; Settings shows status, and Download with progress when missing (large-v3-turbo q5_0 + Core ML encoder from huggingface). |
| Memory saver | Settings › General | unload after 5/15 (default)/60 min idle or keep loaded; a dictation key-down reloads it (Flow Bar: "Loading speech model…"). |
| whisper-server | `vendor/whisper/whisper-server` → `Resources/whisper/whisper-server` | arm64, Metal + Core ML, static (`scripts/build-whisper.sh`); signed by `scripts/sign.sh` before the bundle. |
| Learn from my edits | Settings › System › Extras (default on) | helper `focusedText` reads the focused field's AXValue (secure fields skipped); checks 6/15/30 s after a paste and before the next dictation; `src/shared/learn.ts` (RoyFlow's `corrections()`); adds through main's store patch, Flow Bar "Added “X” to your dictionary". |
| Focus Mode | Settings › System › Focus Mode | helper reports app activations and hides by pid (`hide`). |
| New microphone offer | Settings › System › Extras (default on) | helper listens for CoreAudio device changes; physical devices only (no Zoom/Teams virtual devices); Flow Bar "{mic} connected · Switch". |
| 20-minute cap | dictation | "1 minute left" at 19 min, stops and pastes at 20 min. |
| Already in Roy Flow (not re-ported) | | Esc cancel with Undo (6 s, re-transcribes the cancelled audio with Whisper only when Undo is pressed), "Using {mic}" tip. |

Notetaker stays on Apple Speech (live segments). Self-test: `ROYFLOW_SELFTEST_WAV=x.wav "Roy Flow.app/Contents/MacOS/Roy Flow"`
runs a WAV through the Whisper engine path (no windows, no single-instance lock, data read-only) and writes
`~/Library/Logs/Roy Flow/whisper-selftest.json` (or `ROYFLOW_SELFTEST_OUT`).
