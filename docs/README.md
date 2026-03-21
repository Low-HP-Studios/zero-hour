# Docs Index

This folder is the project's working memory so we don't have to reverse-engineer our own prototype later.

## What goes here

- Architecture and system boundaries
- Development process / workflow
- Gameplay/system notes
- Performance testing notes
- Asset pipeline + attribution notes
- Decisions and trade-offs
- Roadmap / backlog

## Suggested writing rule

When a change affects behavior, add a short note here in the same PR/commit.
Small notes now beat a beautiful postmortem later.

## File Map

- `ARCHITECTURE.md` - system design, module boundaries, data flow, camera system
- `PROCESS.md` - how we work, change workflow, conventions, platform notes
- `SYSTEMS.md` - gameplay systems breakdown (player, weapon, targets, audio, UI)
- `PERFORMANCE.md` - perf profiling/checklist/stress test notes
- `ASSETS.md` - asset locations, import pipeline, attribution workflow
- `WINDOWS-DISTRIBUTION.md` - current Windows release recommendation, channel choice, and trade-offs
- `DECISIONS.md` - design/technical decisions and why (FPS→TPS, camera, jump, Electron migration, HP targets)
- `ROADMAP.md` - completed work, next steps, backlog

## Doc Conventions

- Date entries using `YYYY-MM-DD`
- Keep sections short and append updates instead of rewriting history
- Call out trade-offs explicitly (because every shortcut invoices us later)
