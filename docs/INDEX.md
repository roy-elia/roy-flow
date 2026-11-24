---
owner: roy-elia
status: active
last_updated: 2026-11-24
source_of_truth: local
tags: [index]
---
# docs index

Purpose: shared, durable context for roy-flow. Read this before placing or finding a file.

There are no other files under `docs/` yet. The long-form documents sit at the repository root.

| File | Summary (one line) | Read when | Owner |
|---|---|---|---|
| `README.md` | What Roy Flow is, install, first launch, update, uninstall, dev commands (root, outside `docs/`) | Building or running the app | roy-elia |
| `QA.md` | Control-by-control QA checklist for release 1.2 (root, outside `docs/`) | Changing UI behaviour | roy-elia |
| `FONTS-LICENSE.txt` | Licences of bundled fonts (root, outside `docs/`) | Adding or changing fonts | roy-elia |

## Where does X go
| I am producing | Put it in | Owning skill | Tracked |
|---|---|---|---|
| Renderer UI (pages, components, flowbar, settings) | `src/pages`, `src/components`, `src/flowbar`, `src/settings` | manual | Yes |
| Logic shared by renderer and main | `src/shared` | manual | Yes |
| Main-process code (Electron) | `electron` | manual | Yes |
| Unit test | `tests/<module>.test.ts` | manual | Yes |
| Swift helper or Parakeet engine | `native` | manual | Yes |
| Build, sign, install or asset-generation script | `scripts` | manual | Yes |
| App icon or tray asset | `build` | manual | Yes |
| Bundled sound or tray image | `resources` | manual | Yes |
| A decision and its reasoning | `docs/decisions/YYYY-MM-DD-<topic>.md` (created on first use) | manual | Yes |
| Session handoff | `state/roy-flow/HANDOFF.md` (created on first use) | session-handoff | Yes |
| Exploratory draft | `output/` | any | No |
| Scratch or pulled copy of an external page | `temp/` | any | No |

## Sources of truth
| Content | System of record | Role of this repo | Link recorded in |
|---|---|---|---|
| Code, docs, decisions | This repository | Owner record | none |
| User notes, settings, models | `~/Library/Application Support/Roy Flow` on each user's Mac | Not stored here | none |
| Anthropic API key | Encrypted on the user's Mac | Never stored here | none |
| Tickets and bugs | GitHub Issues on roy-flow | Link only | Pull request description |

## Rules for this folder
- Every Markdown file here starts with front matter (`templates/front-matter.md` in ai-standards).
- Summaries come before raw sources; raw files go in a `sources/` folder beside their summary.
