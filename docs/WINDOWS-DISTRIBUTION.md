# Windows Distribution

Current recommendation for this repo's Windows release strategy.

## Summary

For this project, the best public Windows path is:

1. Use direct `NSIS` installer builds for friends, testers, and private previews.
2. Save for `Steam Direct` as the first paid public distribution channel.
3. Do not buy a public code-signing certificate yet.
4. Do not prioritize Microsoft Store for the main release.

This app is already packaged as an Electron desktop app with `electron-builder` and a Windows `NSIS` target, so the current build shape is good enough for testing and early distribution.

## Why this is the current call

### Steam fits the audience better than Microsoft Store

This is a game, not a productivity app.
Players already know Steam, trust it, and expect it to handle install/update flow.
Microsoft Store is cheaper on paper, but weaker for the target audience here.

### A code-signing certificate is expensive for a solo developer

Public code-signing certificates are recurring annual cost.
That money does not help discoverability, community, or distribution.
It mostly reduces Windows trust friction for direct downloads.

For an indie game with limited budget, that is the wrong first spend.

### The repo already has a working Windows installer path

Current Windows packaging is already defined in `package.json`:

- `pnpm build:win`
- `electron-builder --win --publish never`
- Windows target: `nsis`

That makes direct private distribution viable right now without changing the app architecture.

## What to use right now

### For testers and friends

Use the existing Windows installer build:

```bash
pnpm build:win
```

Share the generated `.exe` from `release/`.

Expected downside:
Windows SmartScreen may still warn on direct downloads because the installer is not code-signed with a public CA certificate.

### For the first real public release

Use `Steam Direct`.

Why:

- Lower practical cost than buying a recurring code-signing cert
- Better trust with PC players
- Better update and install UX for games
- Better discoverability than Microsoft Store

Expected downside:
Steam requires packaging work and store setup, because nothing in software is allowed to be both cheap and effortless.

## What not to do yet

### Do not buy a code-signing certificate as the first paid step

Reason:

- It is usually annual recurring cost
- It helps direct-download trust, but does not bring players
- It is hard to justify before the game has traction or revenue

Revisit only if:

- the game starts getting real direct-download traffic
- you want polished downloads from your own website
- Steam is not the main channel anymore

### Do not make Microsoft Store the main launch channel

Reason:

- It does not match how most PC players discover and install indie shooters
- It adds packaging/compliance work for a weaker game audience

Revisit only if:

- you want a zero-cost secondary channel later
- you need a trust-friendly fallback channel for non-Steam users

## Repo-specific implications

### Keep the current Windows installer flow

Keep the current `NSIS` path for:

- private testing
- closed demos
- friend builds
- backup distribution

### Plan a separate Steam build lane

When Steam work starts:

- do not ship the existing self-updating GitHub release flow inside the Steam build
- let Steam own updates for Steam users
- keep GitHub Releases only for non-Steam direct builds

The current updater implementation is in `electron/updater.cjs` and is wired to GitHub Releases.

## Open items before a polished Windows release

- Confirm Windows packaging assets exist, especially `build/icon.ico`
- Test the Windows installer on a clean machine
- Verify install, uninstall, desktop shortcut, and Start Menu behavior
- Decide whether the direct-download build should keep auto-update enabled

## Revisit this decision when

- budget exists for ongoing signing costs
- the game has enough players to justify a polished direct-download channel
- Steam release prep is underway
- distribution goals change
