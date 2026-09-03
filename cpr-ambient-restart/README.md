# CPR Ambient Restart

Foundry v12 module. Fixes the thing where an Ambient Sound with a big Muffled
(Reverb) effect — a concert playing behind walls, say — resumes from
wherever it happened to be instead of starting over, no matter how many
times you disable/re-enable it or walk tokens in and out of its radius.

## Why that happens

An `AmbientSound` placeable's managed `Sound` keeps playing continuously in
the background even while inaudible. Toggling it on/off just fades its gain
via `AmbientSound#sync()`, which has no offset/position option — it never
actually stops or replays the track. The only thing that resets it to 0 is
a full canvas rebuild, i.e. everyone reloading their browser tab.

## What this module does

1. Adds a **Restart on Scene Load** checkbox to the Ambient Sound
   configuration sheet (Basic tab). Flip it on for the sound(s) you want to
   always start from the top — leave everything else (torches, wind, etc.)
   untouched.
2. Every client that loads a scene forces its flagged sounds to stop and
   replay from position 0, preserving whatever Special Effect (e.g. Muffled
   → Reverb) is already applied.
3. Adds a GM-only **CPR Ambient Restart** scene-control button (left
   toolbar) that broadcasts an immediate restart of all flagged sounds to
   every connected client on demand — no reload needed. Useful for "the
   band kicks off now" moments mid-session.

## Install

1. Copy this whole `cpr-ambient-restart/` folder into your Foundry
   `Data/modules/` folder.
2. Launch your world, open **Manage Modules**, enable **CPR Ambient
   Restart**, and reload if prompted.
3. Open the Ambient Sound's configuration (double-click it, or right-click
   → Edit), check **Restart on Scene Load**, save.

## Known limitations (v1)

- Restart is stop-then-play on the same `Sound` instance — reasoned from
  the documented `foundry.audio.Sound` API (`stop()`/`play({offset, ...})`)
  rather than tested against a live effect chain. If the Muffled/Reverb
  effect audibly glitches or drops on restart, that's the first place to
  look — flag it and it can be swapped for a placeable redraw instead.
- The scene-load restart is per-client and fires independently as each
  client's canvas becomes ready — if players load at noticeably different
  times, they won't hear the exact same instant, only "from the beginning
  of my own load."
